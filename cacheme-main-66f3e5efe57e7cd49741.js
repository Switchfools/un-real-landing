! function(e) {
    function t(t) {
        for (var n, s, c = t[0], l = t[1], a = t[2], u = 0, f = []; u < c.length; u++) s = c[u], Object.prototype.hasOwnProperty.call(i, s) && i[s] && f.push(i[s][0]), i[s] = 0;
        for (n in l) Object.prototype.hasOwnProperty.call(l, n) && (e[n] = l[n]);
        for (d && d(t); f.length;) f.shift()();
        return r.push.apply(r, a || []), o()
    }

    function o() {
        for (var e, t = 0; t < r.length; t++) {
            for (var o = r[t], n = !0, c = 1; c < o.length; c++) {
                var l = o[c];
                0 !== i[l] && (n = !1)
            }
            n && (r.splice(t--, 1), e = s(s.s = o[0]))
        }
        return e
    }
    var n = {},
        i = {
            1: 0
        },
        r = [];

    function s(t) {
        if (n[t]) return n[t].exports;
        var o = n[t] = {
            i: t,
            l: !1,
            exports: {}
        };
        return e[t].call(o.exports, o, o.exports, s), o.l = !0, o.exports
    }
    s.m = e, s.c = n, s.d = function(e, t, o) {
        s.o(e, t) || Object.defineProperty(e, t, {
            enumerable: !0,
            get: o
        })
    }, s.r = function(e) {
        "undefined" != typeof Symbol && Symbol.toStringTag && Object.defineProperty(e, Symbol.toStringTag, {
            value: "Module"
        }), Object.defineProperty(e, "__esModule", {
            value: !0
        })
    }, s.t = function(e, t) {
        if (1 & t && (e = s(e)), 8 & t) return e;
        if (4 & t && "object" == typeof e && e && e.__esModule) return e;
        var o = Object.create(null);
        if (s.r(o), Object.defineProperty(o, "default", {
                enumerable: !0,
                value: e
            }), 2 & t && "string" != typeof e)
            for (var n in e) s.d(o, n, function(t) {
                return e[t]
            }.bind(null, n));
        return o
    }, s.n = function(e) {
        var t = e && e.__esModule ? function() {
            return e.default
        } : function() {
            return e
        };
        return s.d(t, "a", t), t
    }, s.o = function(e, t) {
        return Object.prototype.hasOwnProperty.call(e, t)
    }, s.p = "/";
    var c = window.webpackJsonp = window.webpackJsonp || [],
        l = c.push.bind(c);
    c.push = t, c = c.slice();
    for (var a = 0; a < c.length; a++) t(c[a]);
    var d = l;
    r.push([42, 5, 4, 3, 0, 2, 6]), o()
}({
    123: function(e, t, o) {
        "use strict";
        var n = this && this.__importDefault || function(e) {
            return e && e.__esModule ? e : {
                default: e
            }
        };
        Object.defineProperty(t, "__esModule", {
            value: !0
        });
        const i = n(o(1));
        o(124), o(40);
        const r = o(125),
            s = o(126),
            c = o(127),
            l = o(128),
            a = o(129),
            d = o(130),
            u = o(131),
            f = o(132),
            b = o(133),
            h = o(134),
            p = o(147),
            v = o(148),
            m = o(149),
            _ = o(151),
            g = o(152);
        i.default(document).ready(() => {
            const e = m.createLocomotiveScroll();
            p.bindHeaderToggleMobile(), v.bindMenuItemClick(), b.bindMobileNav(), d.bindCtaAnimation(), h.bindFeaturedPostSliderMobile(), l.bindWindowResize(), a.bindClipboardCopy(), s.bindFaq(e), "/pricing" === location.pathname && r.bindPricing(), f.bindMobileFooterAccordion(), _.bindFeaturesSectionScroll(e), c.bindScrollDownButton(e), u.scrollToByHash(e), g.init(e)
        })
    },
    125: function(e, t, o) {
        "use strict";
        (function(e) {
            Object.defineProperty(t, "__esModule", {
                value: !0
            }), t.bindPricing = void 0;
            const o = () => {
                    const t = e(".scpricing__box"),
                        o = e(".scpricing__line"),
                        n = t.outerWidth(),
                        i = o.width(),
                        r = n / 2 - i / 2;
                    o.css({
                        transform: `translateX(${r}px)`
                    }), t.on("mouseenter", (function() {
                        const t = e(this).position().left + n / 2 - i / 2;
                        o.css({
                            transform: `translateX(${t}px)`,
                            opacity: 1
                        })
                    })), t.on("mouseleave", (function() {
                        o.css({
                            opacity: 0
                        })
                    }))
                },
                n = (e, t, o, n) => {
                    const i = e.classList.contains("item__btn-add");
                    return i && t < n ? t++ : !i && t > o && t--, t
                },
                i = (e, t, o) => {
                    const n = 400 * e + 200 * t + 10 * o;
                    document.querySelector("#custom-plan-price").innerHTML = (n / 100).toString()
                };
            t.bindPricing = () => {
                o(), (() => {
                    let e = parseInt(document.querySelector("#cpu-value").innerHTML),
                        t = parseInt(document.querySelector("#ram-value").innerHTML),
                        o = parseInt(document.querySelector("#ssd-value").innerHTML);
                    const r = document.querySelector("#cpu"),
                        s = document.querySelector("#ram"),
                        c = document.querySelector("#ssd"),
                        l = document.querySelector("#cpu-value"),
                        a = document.querySelector("#ram-value"),
                        d = document.querySelector("#ssd-value"),
                        u = r.querySelectorAll(".item__btn"),
                        f = s.querySelectorAll(".item__btn"),
                        b = c.querySelectorAll(".item__btn");
                    u.forEach(r => {
                        r.addEventListener("click", () => {
                            e = n(r, e, 1, 6), l.innerHTML = e.toString(), i(e, t, o)
                        })
                    }), f.forEach(r => {
                        r.addEventListener("click", () => {
                            t = n(r, t, 1, 30), a.innerHTML = t.toString(), i(e, t, o)
                        })
                    }), b.forEach(r => {
                        r.addEventListener("click", () => {
                            o = n(r, o, 1, 100), d.innerHTML = o.toString(), i(e, t, o)
                        })
                    })
                })()
            }
        }).call(this, o(1))
    },
    126: function(e, t, o) {
        "use strict";
        (function(e) {
            Object.defineProperty(t, "__esModule", {
                value: !0
            }), t.bindFaq = void 0, t.bindFaq = t => {
                e(".scfaq__item .scfaq__item-question").on("click", (function() {
                    e(this).next().stop().slideToggle(200), e(this).closest(".scfaq__item").toggleClass("active"), e(this).closest(".scfaq__item").siblings(".active").removeClass("active").find(".scfaq__item-answer").stop().slideUp(200), setTimeout((function() {
                        t.update()
                    }), 210)
                }))
            }
        }).call(this, o(1))
    },
    127: function(e, t, o) {
        "use strict";
        (function(e) {
            Object.defineProperty(t, "__esModule", {
                value: !0
            }), t.bindScrollDownButton = void 0, t.bindScrollDownButton = t => {
                e(".btnscrolldown").on("click", (function() {
                    const o = e(this).attr("data-scroll-to"),
                        n = e(this).attr("data-scroll-to-offset"),
                        i = document.querySelector("#" + o);
                    t.scrollTo(i, {
                        offset: n
                    })
                }))
            }
        }).call(this, o(1))
    },
    128: function(e, t, o) {
        "use strict";
        (function(e) {
            Object.defineProperty(t, "__esModule", {
                value: !0
            }), t.bindWindowResize = void 0;
            const n = o(23),
                i = () => {
                    const t = e(window).width();
                    t <= n.screen.mobile ? localStorage.setItem("device", "mobile") : t <= n.screen.tablet ? localStorage.setItem("device", "tablet") : localStorage.setItem("device", "desktop")
                };
            t.bindWindowResize = () => {
                i(), e(window).resize((function() {
                    setTimeout((function() {
                        (() => {
                            const t = e(window).width(),
                                o = localStorage.getItem("device");
                            (t <= n.screen.mobile && "mobile" !== o || t <= n.screen.tablet && t > n.screen.mobile && "tablet" !== o || t > n.screen.tablet && "desktop" !== o) && (location.reload(), i())
                        })()
                    }), 100)
                }))
            }
        }).call(this, o(1))
    },
    129: function(e, t, o) {
        "use strict";
        (function(e) {
            Object.defineProperty(t, "__esModule", {
                value: !0
            }), t.bindClipboardCopy = void 0, t.bindClipboardCopy = () => {
                const t = e("<input>"),
                    o = e(location).attr("href");
                e(".clipboard").on("click", (function(n) {
                    n.preventDefault(), e("body").append(t), t.val(o).select(), document.execCommand("copy"), t.remove()
                }))
            }
        }).call(this, o(1))
    },
    130: function(e, t, o) {
        "use strict";
        (function(e) {
            Object.defineProperty(t, "__esModule", {
                value: !0
            }), t.bindCtaAnimation = void 0, t.bindCtaAnimation = () => {
                const t = e(".sccta__pattern");
                ({
                    initializer: function() {
                        const o = this;
                        o.id = "background_css3", o.style = {
                            bubbles_color: "#FE9501",
                            stroke_width: 0,
                            stroke_color: "black"
                        }, o.bubbles_number = 20, o.speed = [1500, 1e4], o.max_bubbles_height = o.height, o.shape = !1, e("#" + o.id).length > 0 && e("#" + o.id).remove(), o.object = e(`<div style='z - inde: -1; margin: 0; padding: 0; overflow: hidden; position: absolute;\n                bottom: 0' id='${this.id}'> </div>`).appendTo(t), o.ww = e(window).width(), o.wh = e(window).height(), o.width = o.object.width(o.ww), o.height = o.object.height(o.wh), e("body").prepend("<style>.shape_background {transform-origin:center; width:70px; height:70px; background: " + o.style.bubbles_color + "; position: absolute}</style>");
                        for (let e = 0; e < o.bubbles_number; e++) o.generateBubbles()
                    },
                    generateBubbles: function() {
                        const t = this,
                            o = e("<div class='shape_background'></div>"),
                            n = t.shape ? t.shape : Math.floor(t.rn(1, 3));
                        let i;
                        i = 1 === n ? o.css({
                            borderRadius: "50%"
                        }) : 2 === n ? o.css({
                            width: 0,
                            height: 0,
                            "border-style": "solid",
                            "border-width": "0 40px 69.3px 40px",
                            "border-color": "transparent transparent " + t.style.bubbles_color + " transparent",
                            background: "transparent"
                        }) : o;
                        const r = t.rn(.8, 1.2);
                        i.css({
                            transform: "scale(" + r + ") rotate(" + t.rn(-360, 360) + "deg)",
                            top: t.wh + 100,
                            left: t.rn(-60, t.ww + 60)
                        }), i.appendTo(t.object), i.transition({
                            top: t.rn(t.wh / 2, t.wh / 2 - 60),
                            transform: "scale(" + r + ") rotate(" + t.rn(-360, 360) + "deg)",
                            opacity: 0
                        }, t.rn(t.speed[0], t.speed[1]), (function() {
                            e(this).remove(), t.generateBubbles()
                        }))
                    },
                    rn: function(e, t, o) {
                        return o ? Math.random() * (t - e + 1) + e : Math.floor(Math.random() * (t - e + 1) + e)
                    }
                }).initializer()
            }
        }).call(this, o(1))
    },
    131: function(e, t, o) {
        "use strict";
        Object.defineProperty(t, "__esModule", {
            value: !0
        }), t.scrollToByHash = void 0, t.scrollToByHash = e => {
            const t = window.location.hash;
            if (t.length) {
                const o = document.querySelector(t);
                e.scrollTo(o, {
                    offset: 0
                })
            }
        }
    },
    132: function(e, t, o) {
        "use strict";
        (function(e) {
            Object.defineProperty(t, "__esModule", {
                value: !0
            }), t.bindMobileFooterAccordion = void 0, t.bindMobileFooterAccordion = () => {
                e(".footer__right .colnav .title").on("click", (function() {
                    e(this).next().stop().slideToggle(200), e(this).closest(".colnav").toggleClass("active"), e(this).closest(".colnav").siblings(".active").removeClass("active").find(".submenu").stop().slideUp(200)
                }))
            }
        }).call(this, o(1))
    },
    133: function(e, t, o) {
        "use strict";
        (function(e) {
            Object.defineProperty(t, "__esModule", {
                value: !0
            }), t.bindMobileNav = void 0;
            const o = e(".header__btnmenu"),
                n = e(".navmobile__button"),
                i = e(".navmobile"),
                r = e(".navmobile ul li");
            t.bindMobileNav = () => {
                o.click((function() {
                    i.addClass("--show"), setTimeout(() => {
                        n.addClass("active")
                    }, 300)
                })), n.click((function() {
                    n.removeClass("active"), i.removeClass("--show"), setTimeout((function() {
                        r.find("ul").slideUp(100), r.find(".icon").toggleClass("--up")
                    }), 400)
                })), r.on("click", (function() {
                    if (e(this).find("ul").length) {
                        e(this).find("ul").stop().slideToggle(300), e(this).find(".icon").toggleClass("--up")
                    }
                }))
            }
        }).call(this, o(1))
    },
    134: function(e, t, o) {
        "use strict";
        (function(e) {
            var n = this && this.__importDefault || function(e) {
                return e && e.__esModule ? e : {
                    default: e
                }
            };
            Object.defineProperty(t, "__esModule", {
                value: !0
            }), t.bindFeaturedPostSliderMobile = void 0;
            const i = n(o(135)),
                r = o(23);
            t.bindFeaturedPostSliderMobile = () => {
                const t = e(window).width(),
                    o = e(".scmainblog__featured");
                o.length && (t < r.screen.tablet ? new i.default(".scmainblog__featured", {
                    prevNextButtons: !1,
                    pageDots: !0,
                    cellAlign: "center",
                    dragThreshold: 0,
                    wrapAround: !1
                }) : o.find(".flickity-slider").length && new i.default(".scmainblog__featured").destroy())
            }
        }).call(this, o(1))
    },
    147: function(e, t, o) {
        "use strict";
        (function(e) {
            Object.defineProperty(t, "__esModule", {
                value: !0
            }), t.bindHeaderToggleMobile = void 0;
            const n = o(23);
            t.bindHeaderToggleMobile = () => {
                const t = e(".header");
                let o = e(window).scrollTop();
                e(window).on("scroll", (function() {
                    if (e(window).width() < n.screen.tablet && t.length) {
                        const n = e(window).scrollTop();
                        if (n <= 0) return void t.removeClass("--hide");
                        o < n ? t.addClass("--hide") : t.removeClass("--hide"), o = n
                    }
                }))
            }
        }).call(this, o(1))
    },
    148: function(e, t, o) {
        "use strict";
        (function(e) {
            Object.defineProperty(t, "__esModule", {
                value: !0
            }), t.bindMenuItemClick = void 0, t.bindMenuItemClick = () => {
                e(".header a").on("click", (function() {
                    e(".schero__img-earth canvas").hide(), e(".loading").addClass("--show").removeClass("--hide")
                }))
            }
        }).call(this, o(1))
    },
    149: function(e, t, o) {
        "use strict";
        var n = this && this.__importDefault || function(e) {
            return e && e.__esModule ? e : {
                default: e
            }
        };
        Object.defineProperty(t, "__esModule", {
            value: !0
        }), t.createLocomotiveScroll = void 0;
        const i = n(o(150));
        t.createLocomotiveScroll = () => new i.default({
            el: document.querySelector(".scrollmain"),
            reloadOnContextChange: !1,
            smooth: !0,
            resetNativeScroll: !1,
            tablet: {
                smooth: !0
            },
            smartphone: {
                smooth: !1
            }
        })
    },
    151: function(e, t, o) {
        "use strict";
        (function(e) {
            Object.defineProperty(t, "__esModule", {
                value: !0
            }), t.bindFeaturesSectionScroll = void 0, t.bindFeaturesSectionScroll = t => {
                const o = e(".header"),
                    n = e(".scfeaturesmain"),
                    i = e(".scfeaturesmain__controls .item"),
                    r = e(".scfeaturesmain__controls .line");
                n.length && (t.on("call", (t, o) => {
                    if ("enter" === o) {
                        const o = t - 1;
                        i.eq(o).addClass("active").siblings().removeClass("active");
                        const n = e(".scfeaturesmain__controls .item.active"),
                            s = n.position().top + parseInt(n.css("marginTop"));
                        r.css({
                            transform: `translateY(${s}px)`
                        })
                    }
                }), i.on("click", (function() {
                    const n = e(this).index() + 1,
                        i = document.querySelector("#scfeaturesmain__row-" + n),
                        r = (e(window).height() - o.height() - i.offsetHeight) / 2 * -1;
                    t.scrollTo(i, {
                        offset: r
                    })
                })))
            }
        }).call(this, o(1))
    },
    152: function(e, t, o) {
        "use strict";
        (function(e) {
            var n = this && this.__importDefault || function(e) {
                return e && e.__esModule ? e : {
                    default: e
                }
            };
            Object.defineProperty(t, "__esModule", {
                value: !0
            }), t.init = void 0;
            const i = n(o(40));
            t.init = t => {
                i.default("body").on("always", (function() {
                    e(".loading").addClass("--hide"), t.update()
                }))
            }
        }).call(this, o(1))
    },
    23: function(e, t, o) {
        "use strict";
        Object.defineProperty(t, "__esModule", {
            value: !0
        }), t.screen = void 0, t.screen = {
            mobile: 767,
            tablet: 991,
            desktop: 1199
        }
    },
    42: function(e, t, o) {
        "use strict";
        Object.defineProperty(t, "__esModule", {
            value: !0
        }), o(43);
        const n = o(44),
            i = o(48),
            r = o(26),
            s = o(92),
            c = o(39),
            l = o(109),
            a = o(114),
            d = o(115),
            u = o(116),
            f = o(117),
            b = o(118),
            h = o(119),
            p = o(121);
        o(123);
        const v = /^https:\/\/github\.com\/.+\/.+$/,
            m = 2 * i.milliSecondsInASecond,
            _ = Date.now(),
            g = r.Router.create();
        var y;
        ! function(e) {
            const t = document.querySelector(".cookiebox"),
                o = () => {
                    document.cookie = b.COOKIE_CONSENT + "=true; expires=2038-01-19 04:14:07; path=/"
                };

            function n() {
                t.classList.remove("--show")
            }
            e.bind = async () => {
                var e;
                t.querySelector(".--c-close").addEventListener("click", () => {
                    n()
                }), t.querySelector(".--btn-cookies").addEventListener("click", () => {
                    n(), o(), p.enableGoogleAnalytics(), h.enableUxTracking()
                });
                (null === (e = await fetch("/website-backend/ineu").then(e => e.json())) || void 0 === e ? void 0 : e.inEurope) || o(), b.hasUserConsentCookie() ? (p.enableGoogleAnalytics(), h.enableUxTracking()) : setTimeout(() => {
                    t.classList.add("--show")
                }, m)
            }
        }(y || (y = {})), window.addEventListener("load", async () => {
            await y.bind()
        });
        const w = e => {
                const {
                    hash: t
                } = e;
                v.test(t.replace("#", "")) && (location.href = "/ide/" + t)
            },
            S = e => {
                if (!n.isEmpty(e.hash)) return;
                const t = c.getCookie("refreshToken");
                n.isEmpty(t) || (location.href = "/ide")
            };
        (async () => {
            g.onUrlChange(e => w(e)), g.onUrlChange(e => S(e), r.path("/")), g.enqueueCurrentRoute(), (async () => {
                const e = new l.UserActivityBrowserStub(new s.HttpEndpoint("/user-activity"));
                await e.authenticate(c.getCookie("accessToken")), window.addEventListener("beforeunload", async () => {
                    await e.logUserActivity(f.pageSession(Date.now() - _))
                }), e.logUserActivity(a.pageView).then(e => e.logIfError()), document.querySelectorAll("form").forEach(t => t.addEventListener("submit", async o => {
                    o.preventDefault(), e.logUserActivity(d.newsletter).then(e => e.logIfError()), t.submit()
                })), window.location.href.includes("confirmed") && e.logUserActivity(u.completeRegistration).then(e => e.logIfError())
            })()
        })()
    }
});
//# sourceMappingURL=cacheme-main-66f3e5efe57e7cd49741.js.map