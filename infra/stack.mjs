import { Stack, Duration, RemovalPolicy, CfnOutput, Tags, Fn,
  aws_s3 as s3, aws_s3_deployment as deployment, aws_cloudfront as cloudfront, aws_cloudfront_origins as origins,
  aws_lambda as lambda, aws_lambda_event_sources as sources, aws_apigatewayv2 as apigw,
  aws_iam as iam, aws_sqs as sqs, aws_logs as logs, aws_secretsmanager as secrets,
  aws_events as events, aws_events_targets as targets, aws_cloudwatch as cloudwatch,
  aws_cloudwatch_actions as actions, aws_sns as sns, aws_budgets as budgets,
} from 'aws-cdk-lib';

export class EssayStudioStack extends Stack {
  constructor(scope, id, props) {
    super(scope, id, props); Tags.of(this).add('Application', 'UnrealEssayStudio');
    const bucket = (name, versioned = false) => new s3.Bucket(this, name, { bucketName: `unreal-essay-studio-${name.toLowerCase()}-${this.account}-${this.region}`, blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL, encryption: s3.BucketEncryption.S3_MANAGED, enforceSSL: true, versioned, removalPolicy: RemovalPolicy.RETAIN, cors: name === 'Media' ? [{ allowedOrigins: ['*'], allowedMethods: [s3.HttpMethods.POST, s3.HttpMethods.GET, s3.HttpMethods.HEAD], allowedHeaders: ['*'], exposedHeaders: ['ETag'], maxAge: 600 }] : undefined });
    const web = bucket('Web'), media = bucket('Media', true), backup = bucket('Backups', true);
    media.addLifecycleRule({ abortIncompleteMultipartUploadAfter: Duration.days(1) });
    const runtimeSecret = new secrets.Secret(this, 'Runtime', { secretName: 'unreal/essay-studio/runtime', generateSecretString: { secretStringTemplate: '{}', generateStringKey: 'setupNonce' }, removalPolicy: RemovalPolicy.RETAIN });
    const audioSecret = new secrets.Secret(this, 'Audio', { secretName: 'unreal/essay-studio/elevenlabs', generateSecretString: { secretStringTemplate: '{}', generateStringKey: 'setupNonce' }, removalPolicy: RemovalPolicy.RETAIN });
    const publisherSecret = new secrets.Secret(this, 'Publisher', { secretName: 'unreal/essay-studio/github', generateSecretString: { secretStringTemplate: '{}', generateStringKey: 'setupNonce' }, removalPolicy: RemovalPolicy.RETAIN });
    const dlq = new sqs.Queue(this, 'DeadLetters', { queueName: 'UnrealEssayStudio-dead.fifo', fifo: true, enforceSSL: true, retentionPeriod: Duration.days(14) });
    const queue = new sqs.Queue(this, 'Jobs', { queueName: 'UnrealEssayStudio-jobs.fifo', fifo: true, enforceSSL: true, visibilityTimeout: Duration.minutes(32), deadLetterQueue: { queue: dlq, maxReceiveCount: 3 } });
    const environment = { NODE_ENV: 'production', RUNTIME_SECRET_ARN: runtimeSecret.secretArn, AUDIO_SECRET_ARN: audioSecret.secretArn, PUBLISHER_SECRET_ARN: publisherSecret.secretArn, MEDIA_BUCKET: media.bucketName, BACKUP_BUCKET: backup.bucketName, QUEUE_URL: queue.queueUrl };
    const makeFunction = (name, timeout, memorySize) => {
      const logGroup = new logs.LogGroup(this, `${name}Logs`, { logGroupName: `/aws/lambda/UnrealEssayStudio-${name}`, retention: logs.RetentionDays.TWO_WEEKS, removalPolicy: RemovalPolicy.RETAIN });
      const role = new iam.Role(this, `${name}Role`, { assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com') }); logGroup.grantWrite(role);
      const fn = new lambda.Function(this, name, { functionName: `UnrealEssayStudio-${name}`, runtime: lambda.Runtime.NODEJS_24_X, architecture: lambda.Architecture.ARM_64, code: lambda.Code.fromAsset('.build/server'), handler: name === 'API' ? 'lambda.handler' : 'worker.handler', timeout, memorySize, environment, logGroup, role });
      runtimeSecret.grantRead(fn); audioSecret.grantRead(fn); publisherSecret.grantRead(fn); queue.grantSendMessages(fn); media.grantReadWrite(fn);
      const alias = new lambda.Alias(this, `${name}Live`, { aliasName: 'live', version: fn.currentVersion });
      return { fn, alias, logGroup };
    };
    const api = makeFunction('API', Duration.seconds(29), 512), worker = makeFunction('Worker', Duration.minutes(5), 1024);
    audioSecret.grantWrite(api.fn);
    worker.alias.addEventSource(new sources.SqsEventSource(queue, { batchSize: 1, reportBatchItemFailures: true, maxConcurrency: 2 }));
    new events.Rule(this, 'DispatchSweep', { ruleName: 'UnrealEssayStudio-dispatch', schedule: events.Schedule.rate(Duration.minutes(1)), targets: [new targets.LambdaFunction(worker.alias)] });
    const http = new apigw.CfnApi(this, 'HTTP', { name: 'UnrealEssayStudio', protocolType: 'HTTP' });
    const integration = new apigw.CfnIntegration(this, 'Integration', { apiId: http.ref, integrationType: 'AWS_PROXY', integrationUri: api.alias.functionArn, payloadFormatVersion: '2.0', timeoutInMillis: 29000 });
    new apigw.CfnRoute(this, 'Route', { apiId: http.ref, routeKey: '$default', target: `integrations/${integration.ref}` });
    new apigw.CfnStage(this, 'Stage', { apiId: http.ref, stageName: '$default', autoDeploy: true, defaultRouteSettings: { throttlingBurstLimit: 15, throttlingRateLimit: 5 } });
    api.alias.addPermission('Gateway', { principal: new iam.ServicePrincipal('apigateway.amazonaws.com'), sourceArn: `arn:aws:execute-api:${this.region}:${this.account}:${http.ref}/*` });
    const apiOrigin = new origins.HttpOrigin(Fn.select(2, Fn.split('/', http.attrApiEndpoint)));
    const apiBehavior = { origin: apiOrigin, viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS, allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL, cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED, originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER };
    const rewrite = new cloudfront.Function(this, 'StudioRoutes', { code: cloudfront.FunctionCode.fromInline("function handler(event) { var request = event.request; if (request.uri === '/' || request.uri === '/auth/callback' || request.uri === '/oauth/consent') request.uri = '/index.html'; return request; }") });
    const headers = new cloudfront.ResponseHeadersPolicy(this, 'StudioHeaders', { securityHeadersBehavior: {
      contentSecurityPolicy: { contentSecurityPolicy: "default-src 'self'; connect-src 'self' https://*.supabase.co https://*.amazonaws.com; img-src 'self' blob: https://*.amazonaws.com; media-src 'self' blob: https://*.amazonaws.com; style-src 'self'; script-src 'self'; font-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'", override: true },
      contentTypeOptions: { override: true }, referrerPolicy: { referrerPolicy: cloudfront.HeadersReferrerPolicy.NO_REFERRER, override: true }, strictTransportSecurity: { accessControlMaxAge: Duration.days(365), includeSubdomains: true, override: true },
    } });
    const distribution = new cloudfront.Distribution(this, 'Studio', { defaultRootObject: 'index.html', priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
      defaultBehavior: { origin: origins.S3BucketOrigin.withOriginAccessControl(web), viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS, cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED, responseHeadersPolicy: headers, functionAssociations: [{ eventType: cloudfront.FunctionEventType.VIEWER_REQUEST, function: rewrite }] },
      additionalBehaviors: { '/api/*': apiBehavior, '/mcp': apiBehavior, '/.well-known/*': apiBehavior },
    });
    new deployment.BucketDeployment(this, 'StudioAssets', { sources: [deployment.Source.asset('.build/studio')], destinationBucket: web, distribution, distributionPaths: ['/*'], cacheControl: [deployment.CacheControl.noCache()] });
    const alerts = new sns.Topic(this, 'Alerts', { topicName: 'UnrealEssayStudio-alerts' });
    const failures = new logs.MetricFilter(this, 'RecordedJobFailures', { logGroup: worker.logGroup, filterPattern: logs.FilterPattern.stringValue('$.event', '=', 'job_failed'), metricNamespace: 'UnrealEssayStudio', metricName: 'FailedJobs', metricValue: '1', defaultValue: 0 });
    const recordedAlarm = new cloudwatch.Alarm(this, 'RecordedFailuresAlarm', { metric: failures.metric({ statistic: 'Sum', period: Duration.minutes(5) }), threshold: 1, evaluationPeriods: 1, treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING }); recordedAlarm.addAlarmAction(new actions.SnsAction(alerts));
    for (const [name, metric, threshold] of [['DeadLetters', dlq.metricApproximateNumberOfMessagesVisible(), 1], ['WorkerErrors', worker.fn.metricErrors(), 1], ['APIErrorSpike', api.fn.metricErrors(), 3]]) {
      const alarm = new cloudwatch.Alarm(this, `${name}Alarm`, { metric, threshold, evaluationPeriods: 1, comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD, treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING }); alarm.addAlarmAction(new actions.SnsAction(alerts));
    }
    alerts.addToResourcePolicy(new iam.PolicyStatement({ principals: [new iam.ServicePrincipal('budgets.amazonaws.com')], actions: ['sns:Publish'], resources: [alerts.topicArn], conditions: { StringEquals: { 'aws:SourceAccount': this.account } } }));
    new budgets.CfnBudget(this, 'Budget', { budget: { budgetName: 'UnrealEssayStudio-monthly', budgetType: 'COST', timeUnit: 'MONTHLY', budgetLimit: { amount: 10, unit: 'USD' }, costFilters: { TagKeyValue: ['user:Application$UnrealEssayStudio'] } }, notificationsWithSubscribers: [{ notification: { notificationType: 'ACTUAL', comparisonOperator: 'GREATER_THAN', threshold: 80, thresholdType: 'PERCENTAGE' }, subscribers: [{ subscriptionType: 'SNS', address: alerts.topicArn }] }] });
    const providerArn = new iam.OpenIdConnectProvider(this, 'GitHubIdentity', { url: 'https://token.actions.githubusercontent.com', clientIds: ['sts.amazonaws.com'] }).openIdConnectProviderArn;
    const deployRole = new iam.Role(this, 'GitHubDeployRole', { roleName: 'UnrealEssayStudio-GitHubDeploy', assumedBy: new iam.FederatedPrincipal(providerArn, { StringEquals: { 'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com', 'token.actions.githubusercontent.com:sub': 'repo:Switchfools/un-real-landing:environment:essay-studio-production' } }, 'sts:AssumeRoleWithWebIdentity') });
    web.grantReadWrite(deployRole);
    deployRole.addToPolicy(new iam.PolicyStatement({ actions: ['lambda:UpdateFunctionCode', 'lambda:GetFunctionConfiguration', 'lambda:GetFunction', 'lambda:PublishVersion', 'lambda:UpdateAlias', 'lambda:GetAlias'], resources: [api.fn.functionArn, `${api.fn.functionArn}:*`, worker.fn.functionArn, `${worker.fn.functionArn}:*`] }));
    deployRole.addToPolicy(new iam.PolicyStatement({ actions: ['cloudfront:CreateInvalidation'], resources: [distribution.distributionArn] }));
    for (const [name, value] of Object.entries({ StudioURL: `https://${distribution.distributionDomainName}`, MCPURL: `https://${distribution.distributionDomainName}/mcp`, DistributionID: distribution.distributionId, WebBucket: web.bucketName, MediaBucket: media.bucketName, BackupBucket: backup.bucketName, RuntimeSecretArn: runtimeSecret.secretArn, AudioSecretArn: audioSecret.secretArn, PublisherSecretArn: publisherSecret.secretArn, DeployRoleArn: deployRole.roleArn, AlertTopicArn: alerts.topicArn, APIName: api.fn.functionName, WorkerName: worker.fn.functionName })) new CfnOutput(this, name, { value });
  }
}
