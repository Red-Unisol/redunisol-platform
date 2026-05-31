import {
  a as fe,
  b as Re,
  c as ie,
  d as Ve,
  e as Qe,
  f as Te,
  g as _r,
  h as Ur,
  i as Nr,
} from "./chunk-X57OFBAN.js";
import { a as sr } from "./chunk-TWYKGYN7.js";
import {
  a as nr,
  b as me,
  c as Xe,
  d as He,
  e as Ge,
} from "./chunk-I55ONR7V.js";
import {
  e as V,
  f as ze,
  g as Ee,
  h as je,
  i as Me,
  j as Be,
  k as De,
  l as Le,
  m as qe,
  n as Pe,
  o as R,
  p as or,
  q as Oe,
  r as We,
  s as Ye,
  t as ir,
} from "./chunk-FUKRBA2G.js";
import {
  $ as de,
  Aa as C,
  Ba as Ir,
  Ca as P,
  Da as y,
  E as yr,
  Ea as u,
  F as J,
  I as D,
  P as b,
  S as Z,
  V as I,
  W as vr,
  Y as L,
  Z as w,
  c as o,
  da as Ne,
  ea as q,
  f as j,
  fa as n,
  ga as f,
  ha as oe,
  i as G,
  ia as br,
  j as gr,
  k as M,
  l as wr,
  la as Cr,
  ma as Ae,
  n as K,
  o as v,
  oa as kr,
  r as e,
  ra as Fr,
  s as r,
  u as N,
  ua as $,
  v as B,
  w as t,
  wa as Se,
  xa as ye,
  ya as d,
} from "./chunk-GYJQDSMF.js";
import "./chunk-HZL4YIMB.js";
import "./chunk-WAT4OCO3.js";
import "./chunk-A3IIQ6X3.js";
var Kr = "framer-HFeDK",
  Jr = { TkIGPIDyy: "framer-v-1y72jmp" };
var Zr = { bounce: 0.2, delay: 0, duration: 0.4, type: "spring" },
  $r = ({ value: a, children: s }) => {
    let m = G(N),
      l = a ?? m.transition,
      p = K(() => ({ ...m, transition: l }), [JSON.stringify(l)]);
    return e(N.Provider, { value: p, children: s });
  },
  et = t.create(o),
  rt = ({ height: a, id: s, title: m, width: l, ...p }) => ({
    ...p,
    ovJvdDBRs: m ?? p.ovJvdDBRs ?? "Access to Emails",
  }),
  tt = (a, s) =>
    a.layoutDependency ? s.join("-") + a.layoutDependency : s.join("-"),
  at = j(function (a, s) {
    let { activeLocale: m, setLocale: l } = D(),
      {
        style: p,
        className: F,
        layoutId: re,
        variant: i,
        ovJvdDBRs: A,
        ...S
      } = rt(a),
      {
        baseVariant: Q,
        classNames: x,
        clearLoadingGesture: W,
        gestureHandlers: c,
        gestureVariant: T,
        isLoading: Y,
        setGestureState: te,
        setVariant: ae,
        variants: z,
      } = $({ defaultVariant: "TkIGPIDyy", variant: i, variantClassNames: Jr }),
      E = tt(a, z),
      se = v(null),
      X = M(),
      O = [De],
      h = q();
    return e(B, {
      id: re ?? X,
      children: e(et, {
        animate: z,
        initial: !1,
        children: e($r, {
          value: Zr,
          children: e(t.div, {
            ...S,
            ...c,
            className: I(Kr, ...O, "framer-1y72jmp", F, x),
            "data-framer-name": "Variant 1",
            layoutDependency: E,
            layoutId: "TkIGPIDyy",
            ref: s ?? se,
            style: {
              backgroundColor:
                "var(--token-94539f16-8480-49c8-9a5c-337b3e6187f6, rgb(255, 249, 235))",
              borderBottomLeftRadius: 228,
              borderBottomRightRadius: 228,
              borderTopLeftRadius: 228,
              borderTopRightRadius: 228,
              ...p,
            },
            children: e(d, {
              __fromCanvasComponent: !0,
              children: e(o, {
                children: e(t.p, {
                  className: "framer-styles-preset-q9uths",
                  "data-styles-preset": "RKGxIaBMW",
                  children: "Access to Emails",
                }),
              }),
              className: "framer-16335j9",
              "data-framer-name": "Help With Cold Email",
              fonts: ["Inter"],
              layoutDependency: E,
              layoutId: "ZK1ZBQVGE",
              style: { "--framer-paragraph-spacing": "0px" },
              text: A,
              verticalAlignment: "center",
              withExternalLayout: !0,
            }),
          }),
        }),
      }),
    });
  }),
  nt = [
    "@supports (aspect-ratio: 1) { body { --framer-aspect-ratio-supported: auto; } }",
    ".framer-HFeDK.framer-1ed27j8, .framer-HFeDK .framer-1ed27j8 { display: block; }",
    ".framer-HFeDK.framer-1y72jmp { align-content: center; align-items: center; display: flex; flex-direction: column; flex-wrap: nowrap; gap: 10px; height: min-content; justify-content: center; overflow: hidden; padding: 16px 24px 16px 24px; position: relative; width: min-content; will-change: var(--framer-will-change-override, transform); }",
    ".framer-HFeDK .framer-16335j9 { flex: none; height: auto; position: relative; white-space: pre; width: auto; }",
    "@supports (background: -webkit-named-image(i)) and (not (font-palette:dark)) { .framer-HFeDK.framer-1y72jmp { gap: 0px; } .framer-HFeDK.framer-1y72jmp > * { margin: 0px; margin-bottom: calc(10px / 2); margin-top: calc(10px / 2); } .framer-HFeDK.framer-1y72jmp > :first-child { margin-top: 0px; } .framer-HFeDK.framer-1y72jmp > :last-child { margin-bottom: 0px; } }",
    ...Be,
  ],
  ve = L(at, nt, "framer-HFeDK"),
  k = ve;
ve.displayName = "Elements / Advantage";
ve.defaultProps = { height: 60, width: 177 };
Z(ve, {
  ovJvdDBRs: {
    defaultValue: "Access to Emails",
    displayTextArea: !1,
    title: "Title",
    type: b.String,
  },
});
P(
  ve,
  [
    {
      explicitInter: !0,
      fonts: [
        {
          family: "Inter",
          source: "framer",
          style: "normal",
          unicodeRange:
            "U+0460-052F, U+1C80-1C88, U+20B4, U+2DE0-2DFF, U+A640-A69F, U+FE2E-FE2F",
          url: "/assets/5vvr9Vy74if2I6bQbJvbw7SY1pQ.woff2",
          weight: "400",
        },
        {
          family: "Inter",
          source: "framer",
          style: "normal",
          unicodeRange: "U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116",
          url: "/assets/EOr0mi4hNtlgWNn9if640EZzXCo.woff2",
          weight: "400",
        },
        {
          family: "Inter",
          source: "framer",
          style: "normal",
          unicodeRange: "U+1F00-1FFF",
          url: "/assets/Y9k9QrlZAqio88Klkmbd8VoMQc.woff2",
          weight: "400",
        },
        {
          family: "Inter",
          source: "framer",
          style: "normal",
          unicodeRange: "U+0370-03FF",
          url: "/assets/OYrD2tBIBPvoJXiIHnLoOXnY9M.woff2",
          weight: "400",
        },
        {
          family: "Inter",
          source: "framer",
          style: "normal",
          unicodeRange:
            "U+0100-024F, U+0259, U+1E00-1EFF, U+2020, U+20A0-20AB, U+20AD-20CF, U+2113, U+2C60-2C7F, U+A720-A7FF",
          url: "/assets/JeYwfuaPfZHQhEG8U5gtPDZ7WQ.woff2",
          weight: "400",
        },
        {
          family: "Inter",
          source: "framer",
          style: "normal",
          unicodeRange:
            "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+2000-206F, U+2074, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD",
          url: "/assets/vQyevYAyHtARFwPqUzQGpnDs.woff2",
          weight: "400",
        },
        {
          family: "Inter",
          source: "framer",
          style: "normal",
          unicodeRange:
            "U+0102-0103, U+0110-0111, U+0128-0129, U+0168-0169, U+01A0-01A1, U+01AF-01B0, U+1EA0-1EF9, U+20AB",
          url: "/assets/b6Y37FthZeALduNqHicBT6FutY.woff2",
          weight: "400",
        },
      ],
    },
    ...u(Me),
  ],
  { supportsExplicitInterCodegen: !0 },
);
Se.loadFonts([
  "FS;Montserrat-italic",
  "FS;Montserrat-bold italic",
  "FS;Montserrat-bold italic",
  "FS;Montserrat-italic",
]);
var ue = [
    {
      explicitInter: !0,
      fonts: [
        {
          family: "Montserrat",
          source: "fontshare",
          style: "italic",
          url: "/third-party-assets/fontshare/wf/CC6FT7O535LIU5P34T6V2W7R57LGKSDT/KUZZS4REMM64PV6S4GGM77HZQUVJPYU2/3ZPIFBJ6EZFOZSYT4ISIO7DHQQODA5IR.woff2",
          weight: "400",
        },
        {
          family: "Montserrat",
          source: "fontshare",
          style: "italic",
          url: "/third-party-assets/fontshare/wf/WVRVHC26IF7VQKSULH6U5DSAGCYOIAQ7/CPARYH2DVA55XB4ZSTA7WTMPVZAVMNA5/BOBO2BRVXZQHPXSPDS5WN3IZQ5SL56OZ.woff2",
          weight: "700",
        },
      ],
    },
  ],
  xe = [
    '.framer-yOLXo .framer-styles-preset-z5w3na:not(.rich-text-wrapper), .framer-yOLXo .framer-styles-preset-z5w3na.rich-text-wrapper p { --framer-font-family: "Montserrat", "Montserrat Placeholder", sans-serif; --framer-font-family-bold: "Montserrat", "Montserrat Placeholder", sans-serif; --framer-font-family-bold-italic: "Montserrat", "Montserrat Placeholder", sans-serif; --framer-font-family-italic: "Montserrat", "Montserrat Placeholder", sans-serif; --framer-font-open-type-features: normal; --framer-font-size: 16px; --framer-font-style: italic; --framer-font-style-bold: italic; --framer-font-style-bold-italic: italic; --framer-font-style-italic: italic; --framer-font-variation-axes: normal; --framer-font-weight: 400; --framer-font-weight-bold: 700; --framer-font-weight-bold-italic: 700; --framer-font-weight-italic: 400; --framer-letter-spacing: 0em; --framer-line-height: 1.8em; --framer-paragraph-spacing: 20px; --framer-text-alignment: center; --framer-text-color: var(--token-162cc6f1-5b31-4c9d-a955-3d5570248c76, #1d1f13); --framer-text-decoration: none; --framer-text-stroke-color: initial; --framer-text-stroke-width: initial; --framer-text-transform: none; }',
    '@media (max-width: 1199px) and (min-width: 810px) { .framer-yOLXo .framer-styles-preset-z5w3na:not(.rich-text-wrapper), .framer-yOLXo .framer-styles-preset-z5w3na.rich-text-wrapper p { --framer-font-family: "Montserrat", "Montserrat Placeholder", sans-serif; --framer-font-family-bold: "Montserrat", "Montserrat Placeholder", sans-serif; --framer-font-family-bold-italic: "Montserrat", "Montserrat Placeholder", sans-serif; --framer-font-family-italic: "Montserrat", "Montserrat Placeholder", sans-serif; --framer-font-open-type-features: normal; --framer-font-size: 16px; --framer-font-style: italic; --framer-font-style-bold: italic; --framer-font-style-bold-italic: italic; --framer-font-style-italic: italic; --framer-font-variation-axes: normal; --framer-font-weight: 400; --framer-font-weight-bold: 700; --framer-font-weight-bold-italic: 700; --framer-font-weight-italic: 400; --framer-letter-spacing: 0em; --framer-line-height: 1.8em; --framer-paragraph-spacing: 20px; --framer-text-alignment: center; --framer-text-color: var(--token-162cc6f1-5b31-4c9d-a955-3d5570248c76, #1d1f13); --framer-text-decoration: none; --framer-text-stroke-color: initial; --framer-text-stroke-width: initial; --framer-text-transform: none; } }',
    '@media (max-width: 809px) and (min-width: 0px) { .framer-yOLXo .framer-styles-preset-z5w3na:not(.rich-text-wrapper), .framer-yOLXo .framer-styles-preset-z5w3na.rich-text-wrapper p { --framer-font-family: "Montserrat", "Montserrat Placeholder", sans-serif; --framer-font-family-bold: "Montserrat", "Montserrat Placeholder", sans-serif; --framer-font-family-bold-italic: "Montserrat", "Montserrat Placeholder", sans-serif; --framer-font-family-italic: "Montserrat", "Montserrat Placeholder", sans-serif; --framer-font-open-type-features: normal; --framer-font-size: 15px; --framer-font-style: italic; --framer-font-style-bold: italic; --framer-font-style-bold-italic: italic; --framer-font-style-italic: italic; --framer-font-variation-axes: normal; --framer-font-weight: 400; --framer-font-weight-bold: 700; --framer-font-weight-bold-italic: 700; --framer-font-weight-italic: 400; --framer-letter-spacing: 0em; --framer-line-height: 1.8em; --framer-paragraph-spacing: 20px; --framer-text-alignment: center; --framer-text-color: var(--token-162cc6f1-5b31-4c9d-a955-3d5570248c76, #1d1f13); --framer-text-decoration: none; --framer-text-stroke-color: initial; --framer-text-stroke-width: initial; --framer-text-transform: none; } }',
  ],
  ge = "framer-yOLXo";
var lt = y(V),
  dt = y(R),
  ft = ["tzVoubfhQ", "udCGrF5ph"],
  mt = "framer-ClRLm",
  ct = { tzVoubfhQ: "framer-v-13u8y1e", udCGrF5ph: "framer-v-2agt31" };
function pt(a, ...s) {
  let m = {};
  return s?.forEach((l) => l && Object.assign(m, a[l])), m;
}
var ht = { damping: 60, delay: 0, mass: 1, stiffness: 500, type: "spring" },
  Je = (a) => (Array.isArray(a) ? a.length > 0 : a != null && a !== ""),
  ut = ({ value: a, children: s }) => {
    let m = G(N),
      l = a ?? m.transition,
      p = K(() => ({ ...m, transition: l }), [JSON.stringify(l)]);
    return e(N.Provider, { value: p, children: s });
  },
  xt = t.create(o),
  gt = { Default: "tzVoubfhQ", Featured: "udCGrF5ph" },
  wt = ({
    additionalText: a,
    buttonLink: s,
    buttonText: m,
    description: l,
    height: p,
    id: F,
    planType: re,
    point1: i,
    point2: A,
    point3: S,
    width: Q,
    ...x
  }) => ({
    ...x,
    aqjDFNtSh: re ?? x.aqjDFNtSh ?? "Lite",
    EvqyuZXFQ: A ?? x.EvqyuZXFQ ?? "Brand colours",
    fOsmDMmXP:
      l ??
      x.fOsmDMmXP ??
      "Quickly receive a high-quality brand logo, representing your business vision.",
    GQONxYmTc: a ?? x.GQONxYmTc ?? "*No commitment \u2013 cancel anytime*",
    NTCCp42Ny: m ?? x.NTCCp42Ny ?? "Get started",
    variant: gt[x.variant] ?? x.variant ?? "tzVoubfhQ",
    WNbhzSMBJ: i ?? x.WNbhzSMBJ ?? "Primary logo",
    y5thXLVlQ: S ?? x.y5thXLVlQ ?? "48hr delivery",
    yTPGGjUXP: s ?? x.yTPGGjUXP,
  }),
  yt = (a, s) =>
    a.layoutDependency ? s.join("-") + a.layoutDependency : s.join("-"),
  vt = j(function (a, s) {
    let m = v(null),
      l = s ?? m,
      p = M(),
      { activeLocale: F, setLocale: re } = D(),
      i = q(),
      {
        style: A,
        className: S,
        layoutId: Q,
        variant: x,
        aqjDFNtSh: W,
        fOsmDMmXP: c,
        WNbhzSMBJ: T,
        EvqyuZXFQ: Y,
        y5thXLVlQ: te,
        NTCCp42Ny: ae,
        yTPGGjUXP: z,
        GQONxYmTc: E,
        ...se
      } = wt(a),
      {
        baseVariant: X,
        classNames: O,
        clearLoadingGesture: h,
        gestureHandlers: U,
        gestureVariant: le,
        isLoading: ne,
        setGestureState: hr,
        setVariant: ur,
        variants: Ue,
      } = $({
        cycleOrder: ft,
        defaultVariant: "tzVoubfhQ",
        ref: l,
        variant: x,
        variantClassNames: ct,
      }),
      g = yt(a, Ue),
      tr = I(mt, ...[Pe, Te, je, ge]),
      ar = () => X === "udCGrF5ph",
      _ = Je(T),
      H = Je(Y),
      Xr = Je(te),
      Hr = Je(E);
    return e(B, {
      id: Q ?? p,
      children: e(xt, {
        animate: Ue,
        initial: !1,
        children: e(ut, {
          value: ht,
          children: r(t.div, {
            ...se,
            ...U,
            className: I(tr, "framer-13u8y1e", S, O),
            "data-border": !0,
            "data-framer-name": "Default",
            layoutDependency: g,
            layoutId: "tzVoubfhQ",
            ref: l,
            style: {
              "--border-bottom-width": "1px",
              "--border-color":
                "var(--token-d626c3c3-2d1d-43fc-a261-41c3249f6a7c, rgb(234, 240, 221))",
              "--border-left-width": "1px",
              "--border-right-width": "1px",
              "--border-style": "solid",
              "--border-top-width": "1px",
              backgroundColor:
                "var(--token-0d217399-5502-4e36-ad35-aff6664c8307, rgb(255, 255, 255))",
              borderBottomLeftRadius: 16,
              borderBottomRightRadius: 16,
              borderTopLeftRadius: 16,
              borderTopRightRadius: 16,
              ...A,
            },
            ...pt({ udCGrF5ph: { "data-framer-name": "Featured" } }, X, le),
            children: [
              ar() &&
                e(t.div, {
                  className: "framer-18vzrzm",
                  "data-framer-name": "tag",
                  layoutDependency: g,
                  layoutId: "UbVRMS7xG",
                  style: {
                    background:
                      "linear-gradient(143deg, var(--token-94539f16-8480-49c8-9a5c-337b3e6187f6, rgb(247, 248, 245)) 0%, var(--token-5afbb393-f5f6-4e8a-a267-062523956801, rgb(169, 237, 66)) 100%)",
                    borderBottomLeftRadius: 16,
                    borderTopRightRadius: 14,
                  },
                  children: e(d, {
                    __fromCanvasComponent: !0,
                    children: e(o, {
                      children: e(t.p, {
                        className: "framer-styles-preset-8hu1lf",
                        "data-styles-preset": "OiVNRM89a",
                        children: "MOST POPULAR",
                      }),
                    }),
                    className: "framer-1skndv9",
                    fonts: ["Inter"],
                    layoutDependency: g,
                    layoutId: "I1Cm1Ycoy",
                    style: {
                      "--framer-link-text-color": "rgb(0, 153, 255)",
                      "--framer-link-text-decoration": "underline",
                    },
                    verticalAlignment: "top",
                    withExternalLayout: !0,
                  }),
                }),
              r(t.div, {
                className: "framer-vwu7z8",
                "data-framer-name": "Container",
                layoutDependency: g,
                layoutId: "C5oT89Ecb",
                children: [
                  e(d, {
                    __fromCanvasComponent: !0,
                    children: e(o, {
                      children: e(t.p, {
                        className: "framer-styles-preset-153c3t2",
                        "data-styles-preset": "oyGO3_Izt",
                        children: "Lite",
                      }),
                    }),
                    className: "framer-19lt5uu",
                    fonts: ["Inter"],
                    layoutDependency: g,
                    layoutId: "mqUKyiRS6",
                    style: {
                      "--framer-link-text-color": "rgb(0, 153, 255)",
                      "--framer-link-text-decoration": "underline",
                    },
                    text: W,
                    verticalAlignment: "top",
                    withExternalLayout: !0,
                  }),
                  e(d, {
                    __fromCanvasComponent: !0,
                    children: e(o, {
                      children: e(t.p, {
                        className: "framer-styles-preset-149x8zz",
                        "data-styles-preset": "oyQrFUwBY",
                        children:
                          "Quickly receive a high-quality brand logo, representing your business vision.",
                      }),
                    }),
                    className: "framer-5kfseo",
                    fonts: ["Inter"],
                    layoutDependency: g,
                    layoutId: "wkYkRkWgF",
                    style: {
                      "--framer-link-text-color": "rgb(0, 153, 255)",
                      "--framer-link-text-decoration": "underline",
                    },
                    text: c,
                    verticalAlignment: "top",
                    withExternalLayout: !0,
                  }),
                  r(t.div, {
                    className: "framer-wbm19s",
                    "data-framer-name": "Points Container",
                    layoutDependency: g,
                    layoutId: "Z3SAaQz_8",
                    children: [
                      _ &&
                        r(t.div, {
                          className: "framer-1ofgwx4",
                          "data-framer-name": "point 1",
                          layoutDependency: g,
                          layoutId: "omAI_iey7",
                          children: [
                            e(n, {
                              children: e(oe, {
                                className: "framer-zh1ns4-container",
                                isAuthoredByUser: !0,
                                isModuleExternal: !0,
                                layoutDependency: g,
                                layoutId: "Rn0saiUyq-container",
                                nodeId: "Rn0saiUyq",
                                rendersWithMotion: !0,
                                scopeId: "Erf67wMGH",
                                children: e(V, {
                                  color:
                                    "var(--token-162cc6f1-5b31-4c9d-a955-3d5570248c76, rgb(29, 31, 19))",
                                  height: "100%",
                                  iconSearch: "check",
                                  iconSelection: "House",
                                  id: "Rn0saiUyq",
                                  layoutId: "Rn0saiUyq",
                                  mirrored: !1,
                                  selectByList: !1,
                                  style: { height: "100%", width: "100%" },
                                  weight: "bold",
                                  width: "100%",
                                }),
                              }),
                            }),
                            e(d, {
                              __fromCanvasComponent: !0,
                              children: e(o, {
                                children: e(t.p, {
                                  className: "framer-styles-preset-149x8zz",
                                  "data-styles-preset": "oyQrFUwBY",
                                  children: "Primary logo",
                                }),
                              }),
                              className: "framer-4kt1c5",
                              fonts: ["Inter"],
                              layoutDependency: g,
                              layoutId: "v80WlmqxL",
                              style: {
                                "--framer-link-text-color": "rgb(0, 153, 255)",
                                "--framer-link-text-decoration": "underline",
                              },
                              text: T,
                              verticalAlignment: "top",
                              withExternalLayout: !0,
                            }),
                          ],
                        }),
                      H &&
                        r(t.div, {
                          className: "framer-1hwjkz1",
                          "data-framer-name": "point 2",
                          layoutDependency: g,
                          layoutId: "mNTkCyq9G",
                          children: [
                            e(n, {
                              children: e(oe, {
                                className: "framer-aj7vrt-container",
                                isAuthoredByUser: !0,
                                isModuleExternal: !0,
                                layoutDependency: g,
                                layoutId: "XvdurtCL8-container",
                                nodeId: "XvdurtCL8",
                                rendersWithMotion: !0,
                                scopeId: "Erf67wMGH",
                                children: e(V, {
                                  color:
                                    "var(--token-162cc6f1-5b31-4c9d-a955-3d5570248c76, rgb(29, 31, 19))",
                                  height: "100%",
                                  iconSearch: "check",
                                  iconSelection: "House",
                                  id: "XvdurtCL8",
                                  layoutId: "XvdurtCL8",
                                  mirrored: !1,
                                  selectByList: !1,
                                  style: { height: "100%", width: "100%" },
                                  weight: "bold",
                                  width: "100%",
                                }),
                              }),
                            }),
                            e(d, {
                              __fromCanvasComponent: !0,
                              children: e(o, {
                                children: e(t.p, {
                                  className: "framer-styles-preset-149x8zz",
                                  "data-styles-preset": "oyQrFUwBY",
                                  children: "Brand colours",
                                }),
                              }),
                              className: "framer-wdie8k",
                              fonts: ["Inter"],
                              layoutDependency: g,
                              layoutId: "zvZcdDgSq",
                              style: {
                                "--framer-link-text-color": "rgb(0, 153, 255)",
                                "--framer-link-text-decoration": "underline",
                              },
                              text: Y,
                              verticalAlignment: "top",
                              withExternalLayout: !0,
                            }),
                          ],
                        }),
                      Xr &&
                        r(t.div, {
                          className: "framer-2rdgdr",
                          "data-framer-name": "point 3",
                          layoutDependency: g,
                          layoutId: "TOLfh5chN",
                          children: [
                            e(n, {
                              children: e(oe, {
                                className: "framer-1o5yzdb-container",
                                isAuthoredByUser: !0,
                                isModuleExternal: !0,
                                layoutDependency: g,
                                layoutId: "Dsd13bWB3-container",
                                nodeId: "Dsd13bWB3",
                                rendersWithMotion: !0,
                                scopeId: "Erf67wMGH",
                                children: e(V, {
                                  color:
                                    "var(--token-162cc6f1-5b31-4c9d-a955-3d5570248c76, rgb(29, 31, 19))",
                                  height: "100%",
                                  iconSearch: "check",
                                  iconSelection: "House",
                                  id: "Dsd13bWB3",
                                  layoutId: "Dsd13bWB3",
                                  mirrored: !1,
                                  selectByList: !1,
                                  style: { height: "100%", width: "100%" },
                                  weight: "bold",
                                  width: "100%",
                                }),
                              }),
                            }),
                            e(d, {
                              __fromCanvasComponent: !0,
                              children: e(o, {
                                children: e(t.p, {
                                  className: "framer-styles-preset-149x8zz",
                                  "data-styles-preset": "oyQrFUwBY",
                                  children: "48hr delivery",
                                }),
                              }),
                              className: "framer-i9nx3u",
                              fonts: ["Inter"],
                              layoutDependency: g,
                              layoutId: "wTbOVEXU4",
                              style: {
                                "--framer-link-text-color": "rgb(0, 153, 255)",
                                "--framer-link-text-decoration": "underline",
                              },
                              text: te,
                              verticalAlignment: "top",
                              withExternalLayout: !0,
                            }),
                          ],
                        }),
                    ],
                  }),
                  e(n, {
                    height: 52,
                    width: `calc(${i?.width || "100vw"} - 72px)`,
                    y: (i?.y || 0) + 36 + 0 + 0 + 692,
                    children: e(oe, {
                      className: "framer-solj9y-container",
                      layoutDependency: g,
                      layoutId: "obWMoZYPP-container",
                      nodeId: "obWMoZYPP",
                      rendersWithMotion: !0,
                      scopeId: "Erf67wMGH",
                      children: e(R, {
                        cRoeZpcrs: ae,
                        FsefAOOPs:
                          "var(--token-d49ce14e-f5dc-463a-9b8d-4f0e772df7f1, rgb(255, 255, 255))",
                        GrpQ8zFBL: z,
                        height: "100%",
                        id: "obWMoZYPP",
                        layoutId: "obWMoZYPP",
                        RCPR2dydG: "ArrowUpRight",
                        SM93ZbT4W: !0,
                        style: { width: "100%" },
                        variant: "PmpqUdVKb",
                        width: "100%",
                      }),
                    }),
                  }),
                  Hr &&
                    e(d, {
                      __fromCanvasComponent: !0,
                      children: e(o, {
                        children: e(t.p, {
                          className: "framer-styles-preset-z5w3na",
                          "data-styles-preset": "AfSbvoluX",
                          children: "*No commitment \u2013 cancel anytime*",
                        }),
                      }),
                      className: "framer-5bzy0d",
                      "data-framer-name":
                        "Lead Academy is an academy & community dedicated for lead generation experts & students to share information",
                      fonts: ["Inter"],
                      layoutDependency: g,
                      layoutId: "dHROOlnE9",
                      style: {
                        "--framer-paragraph-spacing": "0px",
                        opacity: 0.8,
                      },
                      text: E,
                      verticalAlignment: "top",
                      withExternalLayout: !0,
                    }),
                ],
              }),
            ],
          }),
        }),
      }),
    });
  }),
  bt = [
    "@supports (aspect-ratio: 1) { body { --framer-aspect-ratio-supported: auto; } }",
    ".framer-ClRLm.framer-8kldgb, .framer-ClRLm .framer-8kldgb { display: block; }",
    ".framer-ClRLm.framer-13u8y1e { align-content: flex-start; align-items: flex-start; display: flex; flex-direction: column; flex-wrap: nowrap; gap: 0px; height: min-content; justify-content: flex-start; overflow: hidden; padding: 36px; position: relative; width: 526px; will-change: var(--framer-will-change-override, transform); }",
    ".framer-ClRLm .framer-18vzrzm { align-content: center; align-items: center; display: flex; flex: none; flex-direction: column; flex-wrap: nowrap; gap: 10px; height: min-content; justify-content: center; overflow: hidden; padding: 6px 12px 6px 12px; position: absolute; right: 1px; top: 1px; width: min-content; will-change: var(--framer-will-change-override, transform); z-index: 1; }",
    ".framer-ClRLm .framer-1skndv9 { flex: none; height: auto; position: relative; white-space: pre; width: auto; }",
    ".framer-ClRLm .framer-vwu7z8 { align-content: flex-start; align-items: flex-start; display: flex; flex: none; flex-direction: column; flex-wrap: nowrap; gap: 28px; height: min-content; justify-content: center; overflow: visible; padding: 0px; position: relative; width: 100%; z-index: 2; }",
    ".framer-ClRLm .framer-19lt5uu, .framer-ClRLm .framer-5kfseo, .framer-ClRLm .framer-5bzy0d { flex: none; height: auto; position: relative; white-space: pre-wrap; width: 100%; word-break: break-word; word-wrap: break-word; }",
    ".framer-ClRLm .framer-wbm19s { align-content: center; align-items: center; display: flex; flex: none; flex-direction: column; flex-wrap: nowrap; gap: 16px; height: min-content; justify-content: center; overflow: hidden; padding: 0px; position: relative; width: 100%; }",
    ".framer-ClRLm .framer-1ofgwx4, .framer-ClRLm .framer-1hwjkz1, .framer-ClRLm .framer-2rdgdr { align-content: center; align-items: center; display: flex; flex: none; flex-direction: row; flex-wrap: nowrap; gap: 8px; height: min-content; justify-content: flex-start; overflow: visible; padding: 0px; position: relative; width: 100%; }",
    ".framer-ClRLm .framer-zh1ns4-container, .framer-ClRLm .framer-aj7vrt-container, .framer-ClRLm .framer-1o5yzdb-container { flex: none; height: 15px; position: relative; width: 15px; }",
    ".framer-ClRLm .framer-4kt1c5, .framer-ClRLm .framer-wdie8k, .framer-ClRLm .framer-i9nx3u { flex: 1 0 0px; height: auto; position: relative; white-space: pre-wrap; width: 1px; word-break: break-word; word-wrap: break-word; }",
    ".framer-ClRLm .framer-solj9y-container { flex: none; height: auto; position: relative; width: 100%; z-index: 3; }",
    ...qe,
    ...Qe,
    ...Ee,
    ...xe,
    '.framer-ClRLm[data-border="true"]::after, .framer-ClRLm [data-border="true"]::after { content: ""; border-width: var(--border-top-width, 0) var(--border-right-width, 0) var(--border-bottom-width, 0) var(--border-left-width, 0); border-color: var(--border-color, none); border-style: var(--border-style, none); width: 100%; height: 100%; position: absolute; box-sizing: border-box; left: 0; top: 0; border-radius: inherit; pointer-events: none; }',
  ],
  be = L(vt, bt, "framer-ClRLm"),
  Ze = be;
be.displayName = "Cards / Pricing";
be.defaultProps = { height: 436, width: 526 };
Z(be, {
  variant: {
    options: ["tzVoubfhQ", "udCGrF5ph"],
    optionTitles: ["Default", "Featured"],
    title: "Variant",
    type: b.Enum,
  },
  aqjDFNtSh: {
    defaultValue: "Lite",
    displayTextArea: !1,
    title: "Plan Type",
    type: b.String,
  },
  fOsmDMmXP: {
    defaultValue:
      "Quickly receive a high-quality brand logo, representing your business vision.",
    displayTextArea: !1,
    title: "Description",
    type: b.String,
  },
  WNbhzSMBJ: {
    defaultValue: "Primary logo",
    displayTextArea: !1,
    title: "Point 1",
    type: b.String,
  },
  EvqyuZXFQ: {
    defaultValue: "Brand colours",
    displayTextArea: !1,
    title: "Point 2",
    type: b.String,
  },
  y5thXLVlQ: {
    defaultValue: "48hr delivery",
    displayTextArea: !1,
    title: "Point 3",
    type: b.String,
  },
  NTCCp42Ny: {
    defaultValue: "Get started",
    displayTextArea: !1,
    title: "Button text",
    type: b.String,
  },
  yTPGGjUXP: { title: "Button Link", type: b.Link },
  GQONxYmTc: {
    defaultValue: "*No commitment \u2013 cancel anytime*",
    description: "",
    title: "additional text",
    type: b.String,
  },
});
P(
  be,
  [
    {
      explicitInter: !0,
      fonts: [
        {
          family: "Inter",
          source: "framer",
          style: "normal",
          unicodeRange:
            "U+0460-052F, U+1C80-1C88, U+20B4, U+2DE0-2DFF, U+A640-A69F, U+FE2E-FE2F",
          url: "/assets/5vvr9Vy74if2I6bQbJvbw7SY1pQ.woff2",
          weight: "400",
        },
        {
          family: "Inter",
          source: "framer",
          style: "normal",
          unicodeRange: "U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116",
          url: "/assets/EOr0mi4hNtlgWNn9if640EZzXCo.woff2",
          weight: "400",
        },
        {
          family: "Inter",
          source: "framer",
          style: "normal",
          unicodeRange: "U+1F00-1FFF",
          url: "/assets/Y9k9QrlZAqio88Klkmbd8VoMQc.woff2",
          weight: "400",
        },
        {
          family: "Inter",
          source: "framer",
          style: "normal",
          unicodeRange: "U+0370-03FF",
          url: "/assets/OYrD2tBIBPvoJXiIHnLoOXnY9M.woff2",
          weight: "400",
        },
        {
          family: "Inter",
          source: "framer",
          style: "normal",
          unicodeRange:
            "U+0100-024F, U+0259, U+1E00-1EFF, U+2020, U+20A0-20AB, U+20AD-20CF, U+2113, U+2C60-2C7F, U+A720-A7FF",
          url: "/assets/JeYwfuaPfZHQhEG8U5gtPDZ7WQ.woff2",
          weight: "400",
        },
        {
          family: "Inter",
          source: "framer",
          style: "normal",
          unicodeRange:
            "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+2000-206F, U+2074, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD",
          url: "/assets/vQyevYAyHtARFwPqUzQGpnDs.woff2",
          weight: "400",
        },
        {
          family: "Inter",
          source: "framer",
          style: "normal",
          unicodeRange:
            "U+0102-0103, U+0110-0111, U+0128-0129, U+0168-0169, U+01A0-01A1, U+01AF-01B0, U+1EA0-1EF9, U+20AB",
          url: "/assets/b6Y37FthZeALduNqHicBT6FutY.woff2",
          weight: "400",
        },
      ],
    },
    ...lt,
    ...dt,
    ...u(Le),
    ...u(Ve),
    ...u(ze),
    ...u(ue),
  ],
  { supportsExplicitInterCodegen: !0 },
);
var Ft = y(R),
  It = ["hQk71P6gN", "q9BW4xksx", "ViY0k6XSo"],
  _t = "framer-qjejg",
  Ut = {
    hQk71P6gN: "framer-v-13bvi3t",
    q9BW4xksx: "framer-v-ocy3we",
    ViY0k6XSo: "framer-v-ep0jii",
  };
function Nt(a, ...s) {
  let m = {};
  return s?.forEach((l) => l && Object.assign(m, a[l])), m;
}
var At = { bounce: 0.2, delay: 0, duration: 0.4, type: "spring" },
  Ar = { opacity: 0.001, rotate: 0, scale: 1, skewX: 0, skewY: 0, x: 0, y: 5 },
  St = { damping: 100, delay: 0.05, mass: 1, stiffness: 400, type: "spring" },
  Rt = {
    effect: Ar,
    repeat: !1,
    startDelay: 0.2,
    threshold: 0,
    tokenization: "word",
    transition: St,
    trigger: "onInView",
    type: "appear",
  },
  zt = { damping: 100, delay: 0.01, mass: 1, stiffness: 400, type: "spring" },
  Et = {
    effect: Ar,
    repeat: !1,
    startDelay: 0.3,
    threshold: 0,
    tokenization: "word",
    transition: zt,
    trigger: "onInView",
    type: "appear",
  },
  jt = ({ value: a, children: s }) => {
    let m = G(N),
      l = a ?? m.transition,
      p = K(() => ({ ...m, transition: l }), [JSON.stringify(l)]);
    return e(N.Provider, { value: p, children: s });
  },
  Mt = t.create(o),
  Bt = { Desktop: "hQk71P6gN", Phone: "ViY0k6XSo", Tablet: "q9BW4xksx" },
  Dt = ({ height: a, id: s, link: m, width: l, ...p }) => ({
    ...p,
    q2ZLvvoNH: m ?? p.q2ZLvvoNH,
    variant: Bt[p.variant] ?? p.variant ?? "hQk71P6gN",
  }),
  Lt = (a, s) =>
    a.layoutDependency ? s.join("-") + a.layoutDependency : s.join("-"),
  qt = j(function (a, s) {
    let m = v(null),
      l = s ?? m,
      p = M(),
      { activeLocale: F, setLocale: re } = D(),
      i = q(),
      {
        style: A,
        className: S,
        layoutId: Q,
        variant: x,
        q2ZLvvoNH: W,
        ...c
      } = Dt(a),
      {
        baseVariant: T,
        classNames: Y,
        clearLoadingGesture: te,
        gestureHandlers: ae,
        gestureVariant: z,
        isLoading: E,
        setGestureState: se,
        setVariant: X,
        variants: O,
      } = $({
        cycleOrder: It,
        defaultVariant: "hQk71P6gN",
        ref: l,
        variant: x,
        variantClassNames: Ut,
      }),
      h = Lt(a, O),
      le = I(_t, ...[Ye, Ge]),
      ne = () => T !== "ViY0k6XSo";
    return e(B, {
      id: Q ?? p,
      children: e(Mt, {
        animate: O,
        initial: !1,
        children: e(jt, {
          value: At,
          children: r(t.div, {
            ...c,
            ...ae,
            className: I(le, "framer-13bvi3t", S, Y),
            "data-framer-name": "Desktop",
            layoutDependency: h,
            layoutId: "hQk71P6gN",
            ref: l,
            style: {
              backgroundColor:
                "var(--token-94539f16-8480-49c8-9a5c-337b3e6187f6, rgb(247, 248, 245))",
              ...A,
            },
            ...Nt(
              {
                q9BW4xksx: { "data-framer-name": "Tablet" },
                ViY0k6XSo: { "data-framer-name": "Phone" },
              },
              T,
              z,
            ),
            children: [
              r(t.div, {
                className: "framer-1wulekv",
                "data-framer-name": "container",
                layoutDependency: h,
                layoutId: "AeEgQuRJ5",
                children: [
                  r(t.div, {
                    className: "framer-1pdj0rq",
                    "data-framer-name": "text content",
                    layoutDependency: h,
                    layoutId: "FBQU5CunX",
                    children: [
                      e(t.div, {
                        className: "framer-1nat6xl",
                        "data-framer-name": "logo container",
                        layoutDependency: h,
                        layoutId: "KDVKJaSHT",
                        children: e(Ae, {
                          href: { webPageId: "Ahpw6p2s9" },
                          motionChild: !0,
                          nodeId: "d2noAtQwb",
                          openInNewTab: !1,
                          scopeId: "mnroTOi1K",
                          children: e(ye, {
                            as: "a",
                            background: {
                              alt: "",
                              fit: "fill",
                              intrinsicHeight: 1080,
                              intrinsicWidth: 1080,
                              loading: Ir(
                                (i?.y || 0) + 80 + 0 + 0 + 0 + 0 + 0 + 0.625,
                              ),
                              pixelHeight: 1047,
                              pixelWidth: 1995,
                              positionX: "left",
                              positionY: "center",
                              sizes: "173.9789px",
                              src: "./images/AopSWVTmBXbzMtqi95JPGYYUFK4.png",
                              srcSet:
                                "./images/AopSWVTmBXbzMtqi95JPGYYUFK4.png 512w,./images/AopSWVTmBXbzMtqi95JPGYYUFK4.png 1024w,./images/AopSWVTmBXbzMtqi95JPGYYUFK4.png 1995w",
                            },
                            className: "framer-1bhpzzl framer-oer5jx",
                            "data-framer-name": "logo",
                            layoutDependency: h,
                            layoutId: "d2noAtQwb",
                          }),
                        }),
                      }),
                      e(d, {
                        __fromCanvasComponent: !0,
                        children: e(o, {
                          children: e(t.h2, {
                            className: "framer-styles-preset-qoet5n",
                            "data-styles-preset": "cpwF0WKAN",
                            children: e(t.strong, {
                              children:
                                "\xBFC\xF3mo se financian nuestras actividades?",
                            }),
                          }),
                        }),
                        className: "framer-ivyiek",
                        "data-framer-name":
                          "Have Questions? Ask on our Discord",
                        effect: Rt,
                        fonts: ["Inter", "Inter-Bold"],
                        layoutDependency: h,
                        layoutId: "zHlglQwrv",
                        style: { "--framer-paragraph-spacing": "0px" },
                        verticalAlignment: "top",
                        withExternalLayout: !0,
                      }),
                      e(d, {
                        __fromCanvasComponent: !0,
                        children: e(o, {
                          children: r(t.p, {
                            className: "framer-styles-preset-1jigmkh",
                            "data-styles-preset": "rgOrMEYj1",
                            children: [
                              "Nuestra actividad se financia a trav\xE9s de una ",
                              e(t.strong, {
                                children:
                                  "combinaci\xF3n de patrimonio y fondos propios",
                              }),
                              ", el sistema bancario y el mercado de capitales, as\xED como mediante ",
                              e(t.strong, {
                                children: "alianzas estrat\xE9gicas",
                              }),
                              " con otras mutuales y organismos como FONCAP. Adem\xE1s, el Ahorro Mutual a T\xE9rmino (AMT) constituye un complemento clave en nuestra estructura financiera. Esta ",
                              e(t.strong, {
                                children: "diversidad de fuentes",
                              }),
                              " nos permite ofrecer un respaldo financiero s\xF3lido a nuestros socios e inversores.",
                            ],
                          }),
                        }),
                        className: "framer-18mwbav",
                        "data-framer-name":
                          "ask the questions and doubts you have about the lead academy exclusive, join our discord now and get acess to the general chat where you can ask any problems/ doubts you have",
                        effect: Et,
                        fonts: ["Inter", "Inter-Bold"],
                        layoutDependency: h,
                        layoutId: "B2Rur4vVJ",
                        style: { "--framer-paragraph-spacing": "0px" },
                        verticalAlignment: "top",
                        withExternalLayout: !0,
                      }),
                      e(n, {
                        height: 52,
                        y: (i?.y || 0) + 80 + 0 + 0 + 0 + 0 + 270.8,
                        children: e(oe, {
                          className: "framer-rl9h85-container",
                          layoutDependency: h,
                          layoutId: "pwg9SGjkD-container",
                          nodeId: "pwg9SGjkD",
                          rendersWithMotion: !0,
                          scopeId: "mnroTOi1K",
                          children: e(R, {
                            cRoeZpcrs: "Conoc\xE9 m\xE1s",
                            FsefAOOPs:
                              "var(--token-d49ce14e-f5dc-463a-9b8d-4f0e772df7f1, rgb(255, 255, 255))",
                            GrpQ8zFBL: W,
                            height: "100%",
                            id: "pwg9SGjkD",
                            layoutId: "pwg9SGjkD",
                            RCPR2dydG: "ArrowUpRight",
                            SM93ZbT4W: !0,
                            variant: "PmpqUdVKb",
                            width: "100%",
                          }),
                        }),
                      }),
                    ],
                  }),
                  ne() &&
                    e(t.div, {
                      className: "framer-76okio",
                      "data-framer-name": "scribble",
                      layoutDependency: h,
                      layoutId: "SnvE52gqb",
                      children: e(C, {
                        className: "framer-11nn0oy",
                        "data-framer-name": "Arrow 5",
                        layout: "position",
                        layoutDependency: h,
                        layoutId: "uVXYYKLdQ",
                        opacity: 0.5,
                        style: { opacity: 0.5 },
                        svg: '<svg xmlns="/2000/svg" xmlns:xlink="/1999/xlink" viewBox="0 0 223 170"><path d="M 206.482 57.889 C 181.106 48.022 149.973 42.798 124.842 56.368 C 108.782 65.04 98.253 85.368 101.552 103.375 C 104.667 120.381 114.971 136.285 133.205 138.161 C 142.71 139.138 151.435 135.818 154.429 126.059 C 159.004 111.149 145.803 93.438 134.555 85.268 C 99.452 59.77 45.921 54.129 6.916 73.577" fill="transparent" stroke-width="4.03871" stroke="var(--token-5afbb393-f5f6-4e8a-a267-062523956801, rgb(169, 237, 66))" stroke-linecap="round" stroke-miterlimit="10" stroke-dasharray=""></path><path d="M 26.344 47.438 C 21.165 53.022 9.739 66.135 5.466 73.905" fill="transparent" stroke-width="4.03871" stroke="var(--token-5afbb393-f5f6-4e8a-a267-062523956801, rgb(169, 237, 66))" stroke-linecap="round" stroke-miterlimit="10" stroke-dasharray=""></path><path d="M 5.465 73.9 C 12.83 75.842 29.503 80.793 37.273 85.065" fill="transparent" stroke-width="4.03871" stroke="var(--token-5afbb393-f5f6-4e8a-a267-062523956801, rgb(169, 237, 66))" stroke-linecap="round" stroke-miterlimit="10" stroke-dasharray=""></path></svg>',
                        svgContentId: 11072973503,
                        withExternalLayout: !0,
                      }),
                    }),
                ],
              }),
              e(t.div, {
                className: "framer-1vfpz",
                "data-framer-name": "border separator",
                layoutDependency: h,
                layoutId: "NEIJv8_tO",
                style: {
                  backgroundColor:
                    "var(--token-d626c3c3-2d1d-43fc-a261-41c3249f6a7c, rgb(234, 240, 221))",
                  borderBottomLeftRadius: 20,
                  borderBottomRightRadius: 20,
                  borderTopLeftRadius: 20,
                  borderTopRightRadius: 20,
                },
              }),
              e(t.div, {
                className: "framer-14egghp",
                "data-framer-name": "border separator",
                layoutDependency: h,
                layoutId: "A2LTxxDOq",
                style: {
                  backgroundColor:
                    "var(--token-d626c3c3-2d1d-43fc-a261-41c3249f6a7c, rgb(234, 240, 221))",
                  borderBottomLeftRadius: 20,
                  borderBottomRightRadius: 20,
                  borderTopLeftRadius: 20,
                  borderTopRightRadius: 20,
                },
              }),
              ne() &&
                e(t.div, {
                  className: "framer-16u093v",
                  "data-framer-name": "scribble",
                  layoutDependency: h,
                  layoutId: "k3E6WTAti",
                  style: { rotate: 184 },
                  children: e(C, {
                    className: "framer-n5bir5",
                    "data-framer-name": "Swirls",
                    layout: "position",
                    layoutDependency: h,
                    layoutId: "BkIMSiglw",
                    opacity: 0.33,
                    style: { opacity: 0.33 },
                    svg: '<svg xmlns="/2000/svg" xmlns:xlink="/1999/xlink" viewBox="0 0 138 71"><path d="M 15.093 2.504 C 10.111 2.504 4.866 9.409 3.622 13.936 C 1.583 21.353 1.865 29.763 2.396 37.387 C 2.942 45.217 6.058 54.867 13.23 59.128 C 18.864 62.475 28.643 63.551 35.045 62.108 C 41.261 60.707 47.98 55.498 50.291 49.601 C 51.883 45.539 51.976 39.376 49.164 35.872 C 47.14 33.351 41.362 32.762 39.016 34.945 C 35.541 38.176 32.578 42.487 31.957 47.305 C 30.98 54.879 32.343 59.722 38.967 64.013 C 47.526 69.558 61.108 69.867 70.243 66.114 C 80.467 61.914 91.319 53.518 96.323 43.543 C 98.614 38.978 99.752 34.057 100.147 28.984 C 100.374 26.069 100.846 22.283 99.167 19.701 C 96.42 15.477 90.348 14.566 86.568 18.333 C 83.062 21.827 82.577 27.862 83.92 32.452 C 84.987 36.097 89.378 38.98 92.5 40.758 C 96.527 43.051 101.977 43.426 106.52 43.396 C 119.669 43.309 129.028 30.234 135.982 20.532" fill="transparent" stroke-width="3.11" stroke="var(--token-5afbb393-f5f6-4e8a-a267-062523956801, rgb(169, 237, 66))" stroke-linecap="round" stroke-miterlimit="10"></path></svg>',
                    svgContentId: 9742693615,
                    withExternalLayout: !0,
                  }),
                }),
            ],
          }),
        }),
      }),
    });
  }),
  Pt = [
    "@supports (aspect-ratio: 1) { body { --framer-aspect-ratio-supported: auto; } }",
    ".framer-qjejg.framer-oer5jx, .framer-qjejg .framer-oer5jx { display: block; }",
    ".framer-qjejg.framer-13bvi3t { align-content: center; align-items: center; display: flex; flex-direction: column; flex-wrap: nowrap; gap: 10px; height: min-content; justify-content: flex-start; overflow: hidden; padding: 80px 40px 80px 40px; position: relative; width: 1200px; }",
    ".framer-qjejg .framer-1wulekv { align-content: center; align-items: center; display: flex; flex: none; flex-direction: column; flex-wrap: nowrap; gap: 24px; height: min-content; justify-content: center; max-width: 1240px; overflow: visible; padding: 0px; position: relative; width: 100%; }",
    ".framer-qjejg .framer-1pdj0rq { align-content: center; align-items: center; display: flex; flex: none; flex-direction: column; flex-wrap: nowrap; gap: 16px; height: min-content; justify-content: center; overflow: hidden; padding: 0px; position: relative; width: 100%; }",
    ".framer-qjejg .framer-1nat6xl { align-content: center; align-items: center; aspect-ratio: 3.4545454545454546 / 1; display: flex; flex: none; flex-direction: row; flex-wrap: nowrap; gap: 10px; height: var(--framer-aspect-ratio-supported, 50px); justify-content: center; overflow: hidden; padding: 0px; position: relative; width: 173px; }",
    ".framer-qjejg .framer-1bhpzzl { flex: none; height: 98%; overflow: visible; position: relative; text-decoration: none; width: 101%; }",
    ".framer-qjejg .framer-ivyiek { flex: none; height: auto; max-width: 720px; position: relative; white-space: pre-wrap; width: 100%; word-break: break-word; word-wrap: break-word; }",
    ".framer-qjejg .framer-18mwbav { flex: none; height: auto; max-width: 660px; position: relative; white-space: pre-wrap; width: 100%; word-break: break-word; word-wrap: break-word; }",
    ".framer-qjejg .framer-rl9h85-container { flex: none; height: auto; position: relative; width: auto; z-index: 3; }",
    ".framer-qjejg .framer-76okio { bottom: -78px; flex: none; height: 170px; overflow: hidden; position: absolute; right: 198px; width: 223px; z-index: 1; }",
    ".framer-qjejg .framer-11nn0oy { flex: none; height: 170px; left: 0px; position: absolute; top: 0px; width: 223px; }",
    ".framer-qjejg .framer-1vfpz { flex: none; height: 2px; left: 0px; position: absolute; top: 0px; width: 77%; z-index: 3; }",
    ".framer-qjejg .framer-14egghp { bottom: 0px; flex: none; height: 2px; position: absolute; right: 0px; width: 77%; z-index: 3; }",
    ".framer-qjejg .framer-16u093v { flex: none; height: 70px; left: calc(12.66666666666669% - 138px / 2); overflow: hidden; position: absolute; top: calc(20.607375271149696% - 70px / 2); width: 138px; z-index: 2; }",
    ".framer-qjejg .framer-n5bir5 { flex: none; height: 71px; left: calc(50.00000000000002% - 138px / 2); position: absolute; top: calc(48.57142857142859% - 71px / 2); width: 138px; }",
    ".framer-qjejg.framer-v-ocy3we.framer-13bvi3t { width: 810px; }",
    ".framer-qjejg.framer-v-ocy3we .framer-76okio { right: -23px; }",
    ".framer-qjejg.framer-v-ocy3we .framer-16u093v { left: calc(20.86419753086422% - 138px / 2); top: calc(14.008620689655194% - 70px / 2); }",
    ".framer-qjejg.framer-v-ep0jii.framer-13bvi3t { padding: 80px 20px 80px 20px; width: 390px; }",
    ".framer-qjejg.framer-v-ep0jii .framer-1vfpz, .framer-qjejg.framer-v-ep0jii .framer-14egghp { width: 77%; }",
    ...We,
    ...He,
  ],
  Ce = L(qt, Pt, "framer-qjejg"),
  dr = Ce;
Ce.displayName = "Sections / CTA section";
Ce.defaultProps = { height: 559.6, width: 1200 };
Z(Ce, {
  variant: {
    options: ["hQk71P6gN", "q9BW4xksx", "ViY0k6XSo"],
    optionTitles: ["Desktop", "Tablet", "Phone"],
    title: "Variant",
    type: b.Enum,
  },
  q2ZLvvoNH: { title: "Link", type: b.Link },
});
P(
  Ce,
  [
    {
      explicitInter: !0,
      fonts: [
        {
          family: "Inter",
          source: "framer",
          style: "normal",
          unicodeRange:
            "U+0460-052F, U+1C80-1C88, U+20B4, U+2DE0-2DFF, U+A640-A69F, U+FE2E-FE2F",
          url: "/assets/5vvr9Vy74if2I6bQbJvbw7SY1pQ.woff2",
          weight: "400",
        },
        {
          family: "Inter",
          source: "framer",
          style: "normal",
          unicodeRange: "U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116",
          url: "/assets/EOr0mi4hNtlgWNn9if640EZzXCo.woff2",
          weight: "400",
        },
        {
          family: "Inter",
          source: "framer",
          style: "normal",
          unicodeRange: "U+1F00-1FFF",
          url: "/assets/Y9k9QrlZAqio88Klkmbd8VoMQc.woff2",
          weight: "400",
        },
        {
          family: "Inter",
          source: "framer",
          style: "normal",
          unicodeRange: "U+0370-03FF",
          url: "/assets/OYrD2tBIBPvoJXiIHnLoOXnY9M.woff2",
          weight: "400",
        },
        {
          family: "Inter",
          source: "framer",
          style: "normal",
          unicodeRange:
            "U+0100-024F, U+0259, U+1E00-1EFF, U+2020, U+20A0-20AB, U+20AD-20CF, U+2113, U+2C60-2C7F, U+A720-A7FF",
          url: "/assets/JeYwfuaPfZHQhEG8U5gtPDZ7WQ.woff2",
          weight: "400",
        },
        {
          family: "Inter",
          source: "framer",
          style: "normal",
          unicodeRange:
            "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+2000-206F, U+2074, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD",
          url: "/assets/vQyevYAyHtARFwPqUzQGpnDs.woff2",
          weight: "400",
        },
        {
          family: "Inter",
          source: "framer",
          style: "normal",
          unicodeRange:
            "U+0102-0103, U+0110-0111, U+0128-0129, U+0168-0169, U+01A0-01A1, U+01AF-01B0, U+1EA0-1EF9, U+20AB",
          url: "/assets/b6Y37FthZeALduNqHicBT6FutY.woff2",
          weight: "400",
        },
        {
          family: "Inter",
          source: "framer",
          style: "normal",
          unicodeRange:
            "U+0460-052F, U+1C80-1C88, U+20B4, U+2DE0-2DFF, U+A640-A69F, U+FE2E-FE2F",
          url: "/assets/DpPBYI0sL4fYLgAkX8KXOPVt7c.woff2",
          weight: "700",
        },
        {
          family: "Inter",
          source: "framer",
          style: "normal",
          unicodeRange: "U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116",
          url: "/assets/4RAEQdEOrcnDkhHiiCbJOw92Lk.woff2",
          weight: "700",
        },
        {
          family: "Inter",
          source: "framer",
          style: "normal",
          unicodeRange: "U+1F00-1FFF",
          url: "/assets/1K3W8DizY3v4emK8Mb08YHxTbs.woff2",
          weight: "700",
        },
        {
          family: "Inter",
          source: "framer",
          style: "normal",
          unicodeRange: "U+0370-03FF",
          url: "/assets/tUSCtfYVM1I1IchuyCwz9gDdQ.woff2",
          weight: "700",
        },
        {
          family: "Inter",
          source: "framer",
          style: "normal",
          unicodeRange:
            "U+0100-024F, U+0259, U+1E00-1EFF, U+2020, U+20A0-20AB, U+20AD-20CF, U+2113, U+2C60-2C7F, U+A720-A7FF",
          url: "/assets/VgYFWiwsAC5OYxAycRXXvhze58.woff2",
          weight: "700",
        },
        {
          family: "Inter",
          source: "framer",
          style: "normal",
          unicodeRange:
            "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+2000-206F, U+2074, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD",
          url: "/assets/DXD0Q7LSl7HEvDzucnyLnGBHM.woff2",
          weight: "700",
        },
        {
          family: "Inter",
          source: "framer",
          style: "normal",
          unicodeRange:
            "U+0102-0103, U+0110-0111, U+0128-0129, U+0168-0169, U+01A0-01A1, U+01AF-01B0, U+1EA0-1EF9, U+20AB",
          url: "/assets/GIryZETIX4IFypco5pYZONKhJIo.woff2",
          weight: "700",
        },
      ],
    },
    ...Ft,
    ...u(Oe),
    ...u(Xe),
  ],
  { supportsExplicitInterCodegen: !0 },
);
var Vt = { OtDoP2H_D: { hover: !0 } },
  Qt = "framer-uK6ZS",
  Tt = { OtDoP2H_D: "framer-v-1vxxkm4" };
function Ot(a, ...s) {
  let m = {};
  return s?.forEach((l) => l && Object.assign(m, a[l])), m;
}
var Wt = { bounce: 0.2, delay: 0, duration: 0.4, type: "spring" },
  Yt = ({ value: a, children: s }) => {
    let m = G(N),
      l = a ?? m.transition,
      p = K(() => ({ ...m, transition: l }), [JSON.stringify(l)]);
    return e(N.Provider, { value: p, children: s });
  },
  Xt = t.create(o),
  Ht = ({ clientName: a, height: s, id: m, text: l, width: p, ...F }) => ({
    ...F,
    odyoCEm6_: a ?? F.odyoCEm6_ ?? "Brendan Wilson",
    RQnxNmsAq:
      l ??
      F.RQnxNmsAq ??
      "''The courses are top-notch, providing in-depth knowledge that's easy to apply. Each lesson is structured to ensure you fully grasp the material.''",
  }),
  Gt = (a, s) =>
    a.layoutDependency ? s.join("-") + a.layoutDependency : s.join("-"),
  Kt = j(function (a, s) {
    let m = v(null),
      l = s ?? m,
      p = M(),
      { activeLocale: F, setLocale: re } = D(),
      i = q(),
      {
        style: A,
        className: S,
        layoutId: Q,
        variant: x,
        RQnxNmsAq: W,
        odyoCEm6_: c,
        ...T
      } = Ht(a),
      {
        baseVariant: Y,
        classNames: te,
        clearLoadingGesture: ae,
        gestureHandlers: z,
        gestureVariant: E,
        isLoading: se,
        setGestureState: X,
        setVariant: O,
        variants: h,
      } = $({
        defaultVariant: "OtDoP2H_D",
        enabledGestures: Vt,
        ref: l,
        variant: x,
        variantClassNames: Tt,
      }),
      U = Gt(a, h),
      ne = I(Qt, ...[ge, Te]);
    return e(B, {
      id: Q ?? p,
      children: e(Xt, {
        animate: h,
        initial: !1,
        children: e(Yt, {
          value: Wt,
          children: e(t.div, {
            ...T,
            ...z,
            className: I(ne, "framer-1vxxkm4", S, te),
            "data-border": !0,
            "data-framer-name": "Variant 1",
            layoutDependency: U,
            layoutId: "OtDoP2H_D",
            ref: l,
            style: {
              "--border-bottom-width": "1px",
              "--border-color":
                "var(--token-d626c3c3-2d1d-43fc-a261-41c3249f6a7c, rgb(234, 240, 221))",
              "--border-left-width": "1px",
              "--border-right-width": "1px",
              "--border-style": "solid",
              "--border-top-width": "1px",
              background:
                "radial-gradient(50% 50% at 50% 50%, var(--token-2392f422-058e-43d6-a305-98e43baba6b1, rgba(255, 255, 255, 0.4)) 0%, var(--token-d49ce14e-f5dc-463a-9b8d-4f0e772df7f1, rgb(255, 255, 255)) 100%)",
              borderBottomLeftRadius: 24,
              borderBottomRightRadius: 24,
              borderTopLeftRadius: 24,
              borderTopRightRadius: 24,
              ...A,
            },
            ...Ot({ "OtDoP2H_D-hover": { "data-framer-name": void 0 } }, Y, E),
            children: r(t.div, {
              className: "framer-4ct7e0",
              "data-framer-name": "container",
              layoutDependency: U,
              layoutId: "J7NHqMkzt",
              style: {
                borderBottomLeftRadius: 10,
                borderBottomRightRadius: 10,
                borderTopLeftRadius: 10,
                borderTopRightRadius: 10,
              },
              children: [
                e(t.div, {
                  className: "framer-emaoqd",
                  "data-framer-name": "rating & text",
                  layoutDependency: U,
                  layoutId: "Hs51SzQPs",
                  children: e(d, {
                    __fromCanvasComponent: !0,
                    children: e(o, {
                      children: e(t.p, {
                        className: "framer-styles-preset-z5w3na",
                        "data-styles-preset": "AfSbvoluX",
                        style: {
                          "--framer-text-alignment": "left",
                          "--framer-text-color":
                            "var(--extracted-r6o4lv, var(--token-162cc6f1-5b31-4c9d-a955-3d5570248c76, rgb(29, 31, 19)))",
                        },
                        children:
                          "''The courses are top-notch, providing in-depth knowledge that's easy to apply. Each lesson is structured to ensure you fully grasp the material.''",
                      }),
                    }),
                    className: "framer-1ez7qjy",
                    "data-framer-name":
                      "Working with design cryo has been very smooth and enjoyable process, they responds with in hours for any requests. I am subscription user by the way, Saving ton of money this way",
                    fonts: ["Inter"],
                    layoutDependency: U,
                    layoutId: "Bv11xmLpO",
                    style: {
                      "--extracted-r6o4lv":
                        "var(--token-162cc6f1-5b31-4c9d-a955-3d5570248c76, rgb(29, 31, 19))",
                    },
                    text: W,
                    verticalAlignment: "top",
                    withExternalLayout: !0,
                  }),
                }),
                e(t.div, {
                  className: "framer-iya7dv",
                  "data-framer-name": "profile",
                  layoutDependency: U,
                  layoutId: "sidIZtUA7",
                  children: e(t.div, {
                    className: "framer-19fopup",
                    "data-framer-name": "text",
                    layoutDependency: U,
                    layoutId: "fmPBEUrxT",
                    children: e(d, {
                      __fromCanvasComponent: !0,
                      children: e(o, {
                        children: e(t.p, {
                          className: "framer-styles-preset-153c3t2",
                          "data-styles-preset": "oyGO3_Izt",
                          children: "Brendan Wilson",
                        }),
                      }),
                      className: "framer-1xamltm",
                      "data-framer-name": "Desirae Haluk",
                      fonts: ["Inter"],
                      layoutDependency: U,
                      layoutId: "UFk6wJrAX",
                      text: c,
                      verticalAlignment: "top",
                      withExternalLayout: !0,
                    }),
                  }),
                }),
              ],
            }),
          }),
        }),
      }),
    });
  }),
  Jt = [
    "@supports (aspect-ratio: 1) { body { --framer-aspect-ratio-supported: auto; } }",
    ".framer-uK6ZS.framer-1sko6e, .framer-uK6ZS .framer-1sko6e { display: block; }",
    ".framer-uK6ZS.framer-1vxxkm4 { align-content: flex-start; align-items: flex-start; cursor: default; display: flex; flex-direction: column; flex-wrap: nowrap; gap: 20px; height: min-content; justify-content: flex-start; overflow: visible; padding: 36px; position: relative; width: 500px; }",
    ".framer-uK6ZS .framer-4ct7e0 { align-content: center; align-items: center; display: flex; flex: none; flex-direction: column; flex-wrap: nowrap; gap: 20px; height: min-content; justify-content: center; overflow: visible; padding: 0px; position: relative; width: 100%; z-index: 2; }",
    ".framer-uK6ZS .framer-emaoqd { align-content: flex-start; align-items: flex-start; display: flex; flex: none; flex-direction: column; flex-wrap: nowrap; gap: 10px; height: min-content; justify-content: center; overflow: hidden; padding: 0px; position: relative; width: 100%; }",
    ".framer-uK6ZS .framer-1ez7qjy, .framer-uK6ZS .framer-1xamltm { flex: none; height: auto; position: relative; white-space: pre-wrap; width: 100%; word-break: break-word; word-wrap: break-word; }",
    ".framer-uK6ZS .framer-iya7dv { align-content: center; align-items: center; display: flex; flex: none; flex-direction: row; flex-wrap: nowrap; gap: 14px; height: min-content; justify-content: center; overflow: hidden; padding: 0px; position: relative; width: 100%; }",
    ".framer-uK6ZS .framer-19fopup { align-content: center; align-items: center; display: flex; flex: 1 0 0px; flex-direction: column; flex-wrap: nowrap; gap: 4px; height: min-content; justify-content: flex-start; overflow: hidden; padding: 0px; position: relative; width: 1px; }",
    ...xe,
    ...Qe,
    '.framer-uK6ZS[data-border="true"]::after, .framer-uK6ZS [data-border="true"]::after { content: ""; border-width: var(--border-top-width, 0) var(--border-right-width, 0) var(--border-bottom-width, 0) var(--border-left-width, 0); border-color: var(--border-color, none); border-style: var(--border-style, none); width: 100%; height: 100%; position: absolute; box-sizing: border-box; left: 0; top: 0; border-radius: inherit; pointer-events: none; }',
  ],
  ke = L(Kt, Jt, "framer-uK6ZS"),
  Fe = ke;
ke.displayName = "Cards / Review card";
ke.defaultProps = { height: 197.5, width: 500 };
Z(ke, {
  RQnxNmsAq: {
    defaultValue:
      "''The courses are top-notch, providing in-depth knowledge that's easy to apply. Each lesson is structured to ensure you fully grasp the material.''",
    displayTextArea: !1,
    title: "Text",
    type: b.String,
  },
  odyoCEm6_: {
    defaultValue: "Brendan Wilson",
    displayTextArea: !1,
    title: "client name",
    type: b.String,
  },
});
P(
  ke,
  [
    {
      explicitInter: !0,
      fonts: [
        {
          family: "Inter",
          source: "framer",
          style: "normal",
          unicodeRange:
            "U+0460-052F, U+1C80-1C88, U+20B4, U+2DE0-2DFF, U+A640-A69F, U+FE2E-FE2F",
          url: "/assets/5vvr9Vy74if2I6bQbJvbw7SY1pQ.woff2",
          weight: "400",
        },
        {
          family: "Inter",
          source: "framer",
          style: "normal",
          unicodeRange: "U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116",
          url: "/assets/EOr0mi4hNtlgWNn9if640EZzXCo.woff2",
          weight: "400",
        },
        {
          family: "Inter",
          source: "framer",
          style: "normal",
          unicodeRange: "U+1F00-1FFF",
          url: "/assets/Y9k9QrlZAqio88Klkmbd8VoMQc.woff2",
          weight: "400",
        },
        {
          family: "Inter",
          source: "framer",
          style: "normal",
          unicodeRange: "U+0370-03FF",
          url: "/assets/OYrD2tBIBPvoJXiIHnLoOXnY9M.woff2",
          weight: "400",
        },
        {
          family: "Inter",
          source: "framer",
          style: "normal",
          unicodeRange:
            "U+0100-024F, U+0259, U+1E00-1EFF, U+2020, U+20A0-20AB, U+20AD-20CF, U+2113, U+2C60-2C7F, U+A720-A7FF",
          url: "/assets/JeYwfuaPfZHQhEG8U5gtPDZ7WQ.woff2",
          weight: "400",
        },
        {
          family: "Inter",
          source: "framer",
          style: "normal",
          unicodeRange:
            "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+2000-206F, U+2074, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD",
          url: "/assets/vQyevYAyHtARFwPqUzQGpnDs.woff2",
          weight: "400",
        },
        {
          family: "Inter",
          source: "framer",
          style: "normal",
          unicodeRange:
            "U+0102-0103, U+0110-0111, U+0128-0129, U+0168-0169, U+01A0-01A1, U+01AF-01B0, U+1EA0-1EF9, U+20AB",
          url: "/assets/b6Y37FthZeALduNqHicBT6FutY.woff2",
          weight: "400",
        },
      ],
    },
    ...u(ue),
    ...u(Ve),
  ],
  { supportsExplicitInterCodegen: !0 },
);
Se.loadFonts([
  "FS;Montserrat-medium italic",
  "FS;Montserrat-bold italic",
  "FS;Montserrat-bold italic",
  "FS;Montserrat-medium italic",
]);
var Sr = [
    {
      explicitInter: !0,
      fonts: [
        {
          family: "Montserrat",
          source: "fontshare",
          style: "italic",
          url: "/third-party-assets/fontshare/wf/WPZYV4DKXXGBZ3ZQTWYRVOQPYBIT2AN7/QRQ5OKEEZRQ525K55RLKSI4H3LRN5OP7/YJ3ABP6H4VTWOW6FDQ3W5ZIIGLTU346F.woff2",
          weight: "500",
        },
        {
          family: "Montserrat",
          source: "fontshare",
          style: "italic",
          url: "/third-party-assets/fontshare/wf/WVRVHC26IF7VQKSULH6U5DSAGCYOIAQ7/CPARYH2DVA55XB4ZSTA7WTMPVZAVMNA5/BOBO2BRVXZQHPXSPDS5WN3IZQ5SL56OZ.woff2",
          weight: "700",
        },
      ],
    },
  ],
  Rr = [
    '.framer-GvAdQ .framer-styles-preset-1fp0zvd:not(.rich-text-wrapper), .framer-GvAdQ .framer-styles-preset-1fp0zvd.rich-text-wrapper h1 { --framer-font-family: "Montserrat", "Montserrat Placeholder", sans-serif; --framer-font-family-bold: "Montserrat", "Montserrat Placeholder", sans-serif; --framer-font-family-bold-italic: "Montserrat", "Montserrat Placeholder", sans-serif; --framer-font-family-italic: "Montserrat", "Montserrat Placeholder", sans-serif; --framer-font-open-type-features: normal; --framer-font-size: 72px; --framer-font-style: italic; --framer-font-style-bold: italic; --framer-font-style-bold-italic: italic; --framer-font-style-italic: italic; --framer-font-variation-axes: normal; --framer-font-weight: 500; --framer-font-weight-bold: 700; --framer-font-weight-bold-italic: 700; --framer-font-weight-italic: 500; --framer-letter-spacing: -0.01em; --framer-line-height: 120%; --framer-paragraph-spacing: 0px; --framer-text-alignment: center; --framer-text-color: var(--token-162cc6f1-5b31-4c9d-a955-3d5570248c76, #1e420c); --framer-text-decoration: none; --framer-text-stroke-color: initial; --framer-text-stroke-width: initial; --framer-text-transform: none; }',
    '@media (max-width: 1199px) and (min-width: 810px) { .framer-GvAdQ .framer-styles-preset-1fp0zvd:not(.rich-text-wrapper), .framer-GvAdQ .framer-styles-preset-1fp0zvd.rich-text-wrapper h1 { --framer-font-family: "Montserrat", "Montserrat Placeholder", sans-serif; --framer-font-family-bold: "Montserrat", "Montserrat Placeholder", sans-serif; --framer-font-family-bold-italic: "Montserrat", "Montserrat Placeholder", sans-serif; --framer-font-family-italic: "Montserrat", "Montserrat Placeholder", sans-serif; --framer-font-open-type-features: normal; --framer-font-size: 54px; --framer-font-style: italic; --framer-font-style-bold: italic; --framer-font-style-bold-italic: italic; --framer-font-style-italic: italic; --framer-font-variation-axes: normal; --framer-font-weight: 500; --framer-font-weight-bold: 700; --framer-font-weight-bold-italic: 700; --framer-font-weight-italic: 500; --framer-letter-spacing: -0.01em; --framer-line-height: 120%; --framer-paragraph-spacing: 0px; --framer-text-alignment: center; --framer-text-color: var(--token-162cc6f1-5b31-4c9d-a955-3d5570248c76, #1e420c); --framer-text-decoration: none; --framer-text-stroke-color: initial; --framer-text-stroke-width: initial; --framer-text-transform: none; } }',
    '@media (max-width: 809px) and (min-width: 0px) { .framer-GvAdQ .framer-styles-preset-1fp0zvd:not(.rich-text-wrapper), .framer-GvAdQ .framer-styles-preset-1fp0zvd.rich-text-wrapper h1 { --framer-font-family: "Montserrat", "Montserrat Placeholder", sans-serif; --framer-font-family-bold: "Montserrat", "Montserrat Placeholder", sans-serif; --framer-font-family-bold-italic: "Montserrat", "Montserrat Placeholder", sans-serif; --framer-font-family-italic: "Montserrat", "Montserrat Placeholder", sans-serif; --framer-font-open-type-features: normal; --framer-font-size: 40px; --framer-font-style: italic; --framer-font-style-bold: italic; --framer-font-style-bold-italic: italic; --framer-font-style-italic: italic; --framer-font-variation-axes: normal; --framer-font-weight: 500; --framer-font-weight-bold: 700; --framer-font-weight-bold-italic: 700; --framer-font-weight-italic: 500; --framer-letter-spacing: -0.01em; --framer-line-height: 120%; --framer-paragraph-spacing: 0px; --framer-text-alignment: center; --framer-text-color: var(--token-162cc6f1-5b31-4c9d-a955-3d5570248c76, #1e420c); --framer-text-decoration: none; --framer-text-stroke-color: initial; --framer-text-stroke-width: initial; --framer-text-transform: none; } }',
  ],
  zr = "framer-GvAdQ";
var $t = y(ir),
  Er = de(Ne(ye)),
  ea = de(t.div),
  ra = y(R),
  jr = de(f),
  ta = de(d),
  aa = y(V),
  na = de(t.a),
  oa = y(me),
  ia = y(fe),
  fr = Ne(t.div),
  sa = y(k),
  la = y(Re),
  da = y(dr),
  fa = y(Ze),
  Ie = Ne(f),
  ma = y(Fe),
  ca = y(ie),
  pa = y(or),
  ha = y(nr),
  ua = {
    PV7eKQLeF: "(max-width: 809px)",
    wdIKso4zt: "(min-width: 1200px)",
    zH0fe2mqW: "(min-width: 810px) and (max-width: 1199px)",
  },
  xa = () => typeof document < "u",
  ga = "framer-71fo5",
  wa = {
    PV7eKQLeF: "framer-v-1a3i2to",
    wdIKso4zt: "framer-v-1e3fpg9",
    zH0fe2mqW: "framer-v-18h9xl2",
  },
  Mr = { delay: 0, duration: 2, ease: [0, 0, 1, 1], type: "tween" },
  ya = {
    opacity: 1,
    rotate: 0,
    rotateX: 0,
    rotateY: 0,
    scale: 1,
    skewX: 0,
    skewY: 0,
    x: 0,
    y: 17,
  },
  Br = { bounceDamping: 30, bounceStiffness: 400, delay: 0, type: "inertia" },
  Dr = (a) => a.preventDefault(),
  Lr = { cursor: "grabbing" },
  va = { bounce: 0.2, delay: 1, duration: 1.1, type: "spring" },
  ba = {
    opacity: 1,
    rotate: 0,
    rotateX: 0,
    rotateY: 0,
    scale: 1,
    skewX: 0,
    skewY: 0,
    transition: va,
    x: 0,
    y: 0,
  },
  qr = {
    opacity: 0.001,
    rotate: 0,
    rotateX: 0,
    rotateY: 0,
    scale: 0.7,
    skewX: 0,
    skewY: 0,
    x: 0,
    y: 0,
  },
  Ca = {
    opacity: 1,
    rotate: 0,
    rotateX: 0,
    rotateY: 0,
    scale: 1,
    skewX: 0,
    skewY: 0,
    x: 0,
    y: -17,
  },
  ka = { bounce: 0.2, delay: 1.1, duration: 1.1, type: "spring" },
  Fa = {
    opacity: 1,
    rotate: 0,
    rotateX: 0,
    rotateY: 0,
    scale: 1,
    skewX: 0,
    skewY: 0,
    transition: ka,
    x: 0,
    y: 0,
  },
  Tr = { delay: 1.5, duration: 0.6, ease: [0, 0, 1, 1], type: "tween" },
  Pr = {
    opacity: 1,
    rotate: 0,
    rotateX: 0,
    rotateY: 0,
    scale: 1,
    skewX: 0,
    skewY: 0,
    transition: Tr,
    x: 0,
    y: 0,
  },
  mr = {
    opacity: 0.001,
    rotate: 0,
    rotateX: 0,
    rotateY: 0,
    scale: 1,
    skewX: 0,
    skewY: 0,
    x: 0,
    y: 0,
  },
  Or = {
    filter: "blur(2px)",
    opacity: 0.001,
    rotate: 0,
    scale: 1,
    skewX: 0,
    skewY: 0,
    x: 0,
    y: 5,
  },
  pr = { damping: 100, delay: 0.05, mass: 1, stiffness: 400, type: "spring" },
  Ia = {
    effect: Or,
    repeat: !1,
    startDelay: 0.5,
    tokenization: "word",
    transition: pr,
    trigger: "onMount",
    type: "appear",
  },
  _a = {
    effect: Or,
    repeat: !1,
    startDelay: 0.7,
    tokenization: "word",
    transition: pr,
    trigger: "onMount",
    type: "appear",
  },
  Ua = { damping: 40, delay: 1, mass: 1, stiffness: 200, type: "spring" },
  Na = {
    opacity: 1,
    rotate: 0,
    rotateX: 0,
    rotateY: 0,
    scale: 1,
    skewX: 0,
    skewY: 0,
    transition: Ua,
    x: 0,
    y: 0,
  },
  Vr = {
    opacity: 0.001,
    rotate: 0,
    rotateX: 0,
    rotateY: 0,
    scale: 1,
    skewX: 0,
    skewY: 0,
    x: -12,
    y: 0,
  },
  Aa = { damping: 40, delay: 1.1, mass: 1, stiffness: 200, type: "spring" },
  Sa = {
    opacity: 1,
    rotate: 0,
    rotateX: 0,
    rotateY: 0,
    scale: 1,
    skewX: 0,
    skewY: 0,
    transition: Aa,
    x: 0,
    y: 0,
  },
  Ra = {
    opacity: 0.6,
    rotate: 0,
    rotateX: 0,
    rotateY: 0,
    scale: 1,
    skewX: 0,
    skewY: 0,
    transition: Tr,
    x: 0,
    y: 0,
  },
  za = { damping: 30, delay: 0, mass: 1, stiffness: 400, type: "spring" },
  Ea = {
    opacity: 1,
    rotate: 0,
    rotateX: 0,
    rotateY: 0,
    scale: 1.1,
    skewX: 0,
    skewY: 0,
    transition: za,
  },
  Wr = { opacity: 0.001, rotate: 0, scale: 1, skewX: 0, skewY: 0, x: 0, y: 5 },
  $e = {
    effect: Wr,
    repeat: !1,
    startDelay: 0.2,
    threshold: 0,
    tokenization: "word",
    transition: pr,
    trigger: "onInView",
    type: "appear",
  },
  ja = { damping: 100, delay: 0.01, mass: 1, stiffness: 400, type: "spring" },
  er = {
    effect: Wr,
    repeat: !1,
    startDelay: 0.3,
    threshold: 0,
    tokenization: "word",
    transition: ja,
    trigger: "onInView",
    type: "appear",
  },
  ee = {
    opacity: 0,
    rotate: 0,
    rotateX: 0,
    rotateY: 0,
    scale: 1,
    skewX: 0,
    skewY: 0,
    x: 0,
    y: 60,
  },
  we = { bounce: 0.2, delay: 0, duration: 0.6, type: "spring" },
  _e = {
    opacity: 0,
    rotate: 0,
    rotateX: 0,
    rotateY: 0,
    scale: 1,
    skewX: 0,
    skewY: 0,
    transition: we,
    x: 0,
    y: 60,
  },
  cr = { bounce: 0.2, delay: 0.2, duration: 0.6, type: "spring" },
  Qr = {
    opacity: 0,
    rotate: 0,
    rotateX: 0,
    rotateY: 0,
    scale: 1,
    skewX: 0,
    skewY: 0,
    transition: cr,
    x: 0,
    y: 60,
  },
  Yr = { bounce: 0.2, delay: 0.1, duration: 0.6, type: "spring" },
  Ma = {
    opacity: 0,
    rotate: 0,
    rotateX: 0,
    rotateY: 0,
    scale: 1,
    skewX: 0,
    skewY: 0,
    transition: Yr,
    x: 0,
    y: 60,
  },
  Ba = ({ value: a }) =>
    Cr()
      ? null
      : e("style", {
          dangerouslySetInnerHTML: { __html: a },
          "data-framer-html-style": "",
        }),
  Da = { Desktop: "wdIKso4zt", Phone: "PV7eKQLeF", Tablet: "zH0fe2mqW" },
  La = ({ height: a, id: s, width: m, ...l }) => ({
    ...l,
    variant: Da[l.variant] ?? l.variant ?? "wdIKso4zt",
  }),
  qa = j(function (a, s) {
    let m = v(null),
      l = s ?? m,
      p = M(),
      { activeLocale: F, setLocale: re } = D(),
      i = q(),
      { style: A, className: S, layoutId: Q, variant: x, ...W } = La(a);
    gr(() => {
      let _ = sr(void 0, F);
      if (_.robots) {
        let H = document.querySelector('meta[name="robots"]');
        H
          ? H.setAttribute("content", _.robots)
          : ((H = document.createElement("meta")),
            H.setAttribute("name", "robots"),
            H.setAttribute("content", _.robots),
            document.head.appendChild(H));
      }
    }, [void 0, F]),
      wr(() => {
        let _ = sr(void 0, F);
        (document.title = _.title || ""),
          _.viewport &&
            document
              .querySelector('meta[name="viewport"]')
              ?.setAttribute("content", _.viewport);
      }, [void 0, F]);
    let [c, T] = Fr(x, ua, !1),
      Y = void 0,
      ae = I(ga, ...[Pe, zr, Ge, ge, Ye, Nr, je, De]),
      z = J("akRK8f7LT"),
      E = v(null),
      se = yr(),
      X = J("U8RVzCuQJ"),
      O = v(null),
      h = () => (xa() ? c !== "PV7eKQLeF" : !0),
      U = J("Cg0eq09PA"),
      le = v(null),
      ne = J("b5zwtctBu"),
      hr = v(null),
      ur = J("lsjDsgQDk"),
      Ue = v(null),
      g = J("wYofsySfx"),
      xr = v(null),
      tr = J("otFsjtIkD"),
      ar = v(null);
    return (
      br({}),
      e(vr.Provider, {
        value: { primaryVariantId: "wdIKso4zt", variantClassNames: wa },
        children: r(B, {
          id: Q ?? p,
          children: [
            e(Ba, {
              value:
                "html body { background: var(--token-d49ce14e-f5dc-463a-9b8d-4f0e772df7f1, rgb(255, 255, 255)); }",
            }),
            r(t.div, {
              ...W,
              className: I(ae, "framer-1e3fpg9", S),
              ref: l,
              style: { ...A },
              children: [
                e(w, {
                  breakpoint: c,
                  overrides: {
                    PV7eKQLeF: { width: "90vw" },
                    zH0fe2mqW: { width: "90vw" },
                  },
                  children: e(n, {
                    height: 72,
                    width: "min(90vw, 1100px)",
                    y: 20,
                    children: e(f, {
                      className: "framer-1iaakrr-container",
                      layoutScroll: !0,
                      nodeId: "U4rDQV4x1",
                      scopeId: "Ahpw6p2s9",
                      children: e(w, {
                        breakpoint: c,
                        overrides: {
                          PV7eKQLeF: {
                            style: { width: "100%" },
                            variant: "OJbsaliCD",
                          },
                          zH0fe2mqW: {
                            style: { width: "100%" },
                            variant: "OJbsaliCD",
                          },
                        },
                        children: e(ir, {
                          height: "100%",
                          id: "U4rDQV4x1",
                          layoutId: "U4rDQV4x1",
                          PT6wlJnKN:
                            "https://b24-nh2s2f.bitrix24.site/crm_form_otokd/",
                          style: { maxWidth: "100%", width: "100%" },
                          variant: "SgJjfF2Pv",
                          width: "100%",
                        }),
                      }),
                    }),
                  }),
                }),
                r("div", {
                  className: "framer-7neocn",
                  "data-framer-name": "Hero",
                  id: z,
                  ref: E,
                  children: [
                    r("div", {
                      className: "framer-tixfw1",
                      "data-framer-name": "container",
                      children: [
                        e(Er, {
                          __framer__loop: ya,
                          __framer__loopEffectEnabled: !0,
                          __framer__loopRepeatDelay: 0,
                          __framer__loopRepeatType: "mirror",
                          __framer__loopTransition: Mr,
                          __perspectiveFX: !1,
                          __targetOpacity: 1,
                          animate: ba,
                          background: {
                            alt: "widget",
                            fit: "fill",
                            intrinsicHeight: 2288,
                            intrinsicWidth: 2469,
                            pixelHeight: 2288,
                            pixelWidth: 2469,
                            src: "./images/V5YJlEtdhadO7vujOvPN6WJ47I.png",
                          },
                          className: "framer-1buhn8w",
                          "data-framer-appear-id": "1buhn8w",
                          "data-framer-name": "widget",
                          drag: !0,
                          dragMomentum: !1,
                          dragSnapToOrigin: !0,
                          dragTransition: Br,
                          initial: qr,
                          onMouseDown: Dr,
                          optimized: !0,
                          whileTap: Lr,
                        }),
                        e(Er, {
                          __framer__loop: Ca,
                          __framer__loopEffectEnabled: !0,
                          __framer__loopRepeatDelay: 0,
                          __framer__loopRepeatType: "mirror",
                          __framer__loopTransition: Mr,
                          __perspectiveFX: !1,
                          __targetOpacity: 1,
                          animate: Fa,
                          background: {
                            alt: "widget",
                            fit: "fill",
                            intrinsicHeight: 2396,
                            intrinsicWidth: 3034,
                            pixelHeight: 2396,
                            pixelWidth: 3034,
                            src: "./images/uXEz1rLWGpJlZ46ieqKbaxn0s.png",
                          },
                          className: "framer-8r41lt",
                          "data-framer-appear-id": "8r41lt",
                          "data-framer-name": "widget",
                          drag: !0,
                          dragMomentum: !1,
                          dragSnapToOrigin: !0,
                          dragTransition: Br,
                          initial: qr,
                          onMouseDown: Dr,
                          optimized: !0,
                          whileTap: Lr,
                        }),
                        r("div", {
                          className: "framer-rxuu3z",
                          "data-framer-name": "content",
                          children: [
                            e(ea, {
                              animate: Pr,
                              className: "framer-ry1g1k",
                              "data-framer-appear-id": "ry1g1k",
                              "data-framer-name": "top bar",
                              initial: mr,
                              optimized: !0,
                              children: e(d, {
                                __fromCanvasComponent: !0,
                                children: e(o, {
                                  children: e("p", {
                                    className: "framer-styles-preset-8hu1lf",
                                    "data-styles-preset": "OiVNRM89a",
                                    style: {
                                      "--framer-text-alignment": "center",
                                    },
                                    children: "Un proyecto con impacto real",
                                  }),
                                }),
                                className: "framer-1euozh6",
                                "data-framer-name": "Weekly Coaching Calls",
                                fonts: ["Inter"],
                                verticalAlignment: "top",
                                withExternalLayout: !0,
                              }),
                            }),
                            r("div", {
                              className: "framer-utdqrh",
                              "data-framer-name": "heading&sub",
                              children: [
                                e(d, {
                                  __fromCanvasComponent: !0,
                                  children: e(o, {
                                    children: e("h1", {
                                      className: "framer-styles-preset-1fp0zvd",
                                      "data-styles-preset": "GyyhZkl87",
                                      children: "Asociaci\xF3n Mutual Celesol",
                                    }),
                                  }),
                                  className: "framer-1f3pz81",
                                  "data-framer-name":
                                    "An Exclusive Community for lead generation experts",
                                  effect: Ia,
                                  fonts: ["Inter"],
                                  verticalAlignment: "top",
                                  withExternalLayout: !0,
                                }),
                                e(d, {
                                  __fromCanvasComponent: !0,
                                  children: e(o, {
                                    children: r("p", {
                                      className: "framer-styles-preset-1jigmkh",
                                      "data-styles-preset": "rgOrMEYj1",
                                      children: [
                                        "Desde hace ",
                                        e("strong", {
                                          children: "m\xE1s de 20 a\xF1os",
                                        }),
                                        " buscamos promover el bienestar y el crecimiento de ",
                                        e("strong", {
                                          children: "nuestros socios",
                                        }),
                                        ". Conoc\xE9 por qu\xE9 somos ",
                                        e("strong", { children: "referentes" }),
                                        " en el sector mutual.",
                                      ],
                                    }),
                                  }),
                                  className: "framer-i5ukzz",
                                  "data-framer-name":
                                    "Lead Academy is an academy & community dedicated for lead generation experts & students to share information & grow through collaborative efforts.",
                                  effect: _a,
                                  fonts: ["Inter", "Inter-Bold"],
                                  verticalAlignment: "top",
                                  withExternalLayout: !0,
                                }),
                              ],
                            }),
                            r("div", {
                              className: "framer-1i8f6p2",
                              "data-framer-name": "cta",
                              children: [
                                e(kr, {
                                  links: [
                                    {
                                      href: {
                                        hash: ":b5zwtctBu",
                                        webPageId: "Ahpw6p2s9",
                                      },
                                      implicitPathVariables: void 0,
                                    },
                                    {
                                      href: {
                                        hash: ":b5zwtctBu",
                                        webPageId: "Ahpw6p2s9",
                                      },
                                      implicitPathVariables: void 0,
                                    },
                                    {
                                      href: {
                                        hash: ":b5zwtctBu",
                                        webPageId: "Ahpw6p2s9",
                                      },
                                      implicitPathVariables: void 0,
                                    },
                                  ],
                                  children: (_) =>
                                    e(n, {
                                      height: 52,
                                      children: e(jr, {
                                        animate: Na,
                                        className: "framer-r1sdbk-container",
                                        "data-framer-appear-id": "r1sdbk",
                                        initial: Vr,
                                        nodeId: "fg0Pbhwl6",
                                        optimized: !0,
                                        rendersWithMotion: !0,
                                        scopeId: "Ahpw6p2s9",
                                        children: e(w, {
                                          breakpoint: c,
                                          overrides: {
                                            PV7eKQLeF: { GrpQ8zFBL: _[2] },
                                            zH0fe2mqW: { GrpQ8zFBL: _[1] },
                                          },
                                          children: e(R, {
                                            cRoeZpcrs: "Conocer m\xE1s",
                                            FsefAOOPs:
                                              "var(--token-162cc6f1-5b31-4c9d-a955-3d5570248c76, rgb(29, 31, 19))",
                                            GrpQ8zFBL: _[0],
                                            height: "100%",
                                            id: "fg0Pbhwl6",
                                            layoutId: "fg0Pbhwl6",
                                            RCPR2dydG: "Question",
                                            SM93ZbT4W: !1,
                                            variant: "Vpod81CZ2",
                                            width: "100%",
                                          }),
                                        }),
                                      }),
                                    }),
                                }),
                                e(n, {
                                  height: 52,
                                  children: e(jr, {
                                    animate: Sa,
                                    className: "framer-18dm7lu-container",
                                    "data-framer-appear-id": "18dm7lu",
                                    initial: Vr,
                                    nodeId: "IYdljxCcJ",
                                    optimized: !0,
                                    rendersWithMotion: !0,
                                    scopeId: "Ahpw6p2s9",
                                    children: e(R, {
                                      cRoeZpcrs: "Empecemos hoy",
                                      FsefAOOPs:
                                        "var(--token-d49ce14e-f5dc-463a-9b8d-4f0e772df7f1, rgb(255, 255, 255))",
                                      GrpQ8zFBL:
                                        "https://b24-nh2s2f.bitrix24.site/crm_form_otokd/",
                                      height: "100%",
                                      id: "IYdljxCcJ",
                                      layoutId: "IYdljxCcJ",
                                      RCPR2dydG: "ArrowUpRight",
                                      SM93ZbT4W: !0,
                                      variant: "PmpqUdVKb",
                                      width: "100%",
                                    }),
                                  }),
                                }),
                              ],
                            }),
                            e("div", {
                              className: "framer-1v0qwjl",
                              "data-framer-name": "more info",
                              children: e(ta, {
                                __fromCanvasComponent: !0,
                                animate: Ra,
                                children: e(o, {
                                  children: r("p", {
                                    className: "framer-styles-preset-z5w3na",
                                    "data-styles-preset": "AfSbvoluX",
                                    children: [
                                      "Entidad registrada (INAES N\xBA 55281). ",
                                      e("br", {}),
                                      "Proveedor No Financiero regulado por el BCRA.",
                                    ],
                                  }),
                                }),
                                className: "framer-174svav",
                                "data-framer-appear-id": "174svav",
                                "data-framer-name":
                                  "Lead Academy is an academy & community dedicated for lead generation experts & students to share information",
                                fonts: ["Inter"],
                                initial: mr,
                                optimized: !0,
                                verticalAlignment: "top",
                                withExternalLayout: !0,
                              }),
                            }),
                          ],
                        }),
                        r(t.div, {
                          className: "framer-1ac88zf",
                          "data-framer-name": "lines",
                          style: { rotate: 6 },
                          children: [
                            e(C, {
                              className: "framer-6u973x",
                              "data-framer-name": "Vector 1",
                              opacity: 1,
                              svg: '<svg xmlns="/2000/svg" xmlns:xlink="/1999/xlink" viewBox="0 0 612.869 1230.128"><path d="M 5.486 1225.424 C 4.572 1058.169 71.005 692.917 344.053 569.983 C 617.101 447.048 625.8 141.908 596.019 4.704" fill="transparent" stroke-width="11" stroke="var(--token-5afbb393-f5f6-4e8a-a267-062523956801, rgb(238, 195, 66))" stroke-miterlimit="10" stroke-dasharray=""></path></svg>',
                              svgContentId: 12441347657,
                              withExternalLayout: !0,
                            }),
                            e(C, {
                              className: "framer-c39bn5",
                              "data-framer-name": "Vector 1",
                              opacity: 1,
                              svg: '<svg xmlns="/2000/svg" xmlns:xlink="/1999/xlink" viewBox="0 0 612.869 1230.128"><path d="M 5.486 1225.424 C 4.572 1058.169 71.005 692.917 344.053 569.983 C 617.101 447.048 625.8 141.908 596.019 4.704" fill="transparent" stroke-width="11" stroke="var(--token-5afbb393-f5f6-4e8a-a267-062523956801, rgb(238, 195, 66))" stroke-miterlimit="10" stroke-dasharray=""></path></svg>',
                              svgContentId: 12441347657,
                              withExternalLayout: !0,
                            }),
                            e(C, {
                              className: "framer-w98ms7",
                              "data-framer-name": "Vector 1",
                              opacity: 1,
                              svg: '<svg xmlns="/2000/svg" xmlns:xlink="/1999/xlink" viewBox="0 0 612.869 1230.128"><path d="M 5.486 1225.424 C 4.572 1058.169 71.005 692.917 344.053 569.983 C 617.101 447.048 625.8 141.908 596.019 4.704" fill="transparent" stroke-width="11" stroke="var(--token-5afbb393-f5f6-4e8a-a267-062523956801, rgb(238, 195, 66))" stroke-miterlimit="10" stroke-dasharray=""></path></svg>',
                              svgContentId: 12441347657,
                              withExternalLayout: !0,
                            }),
                          ],
                        }),
                        r(t.div, {
                          className: "framer-vn16h0",
                          "data-framer-name": "lines",
                          style: { rotate: 6 },
                          children: [
                            e(C, {
                              className: "framer-sur2ud",
                              "data-framer-name": "Vector 1",
                              opacity: 1,
                              svg: '<svg xmlns="/2000/svg" xmlns:xlink="/1999/xlink" viewBox="0 0 612.869 1230.128"><path d="M 5.486 1225.424 C 4.572 1058.169 71.005 692.917 344.053 569.983 C 617.101 447.048 625.8 141.908 596.019 4.704" fill="transparent" stroke-width="11" stroke="var(--token-5afbb393-f5f6-4e8a-a267-062523956801, rgb(238, 195, 66))" stroke-miterlimit="10" stroke-dasharray=""></path></svg>',
                              svgContentId: 12441347657,
                              withExternalLayout: !0,
                            }),
                            e(C, {
                              className: "framer-8a6vp7",
                              "data-framer-name": "Vector 1",
                              opacity: 1,
                              svg: '<svg xmlns="/2000/svg" xmlns:xlink="/1999/xlink" viewBox="0 0 612.869 1230.128"><path d="M 5.486 1225.424 C 4.572 1058.169 71.005 692.917 344.053 569.983 C 617.101 447.048 625.8 141.908 596.019 4.704" fill="transparent" stroke-width="11" stroke="var(--token-5afbb393-f5f6-4e8a-a267-062523956801, rgb(238, 195, 66))" stroke-miterlimit="10" stroke-dasharray=""></path></svg>',
                              svgContentId: 12441347657,
                              withExternalLayout: !0,
                            }),
                            e(C, {
                              className: "framer-aip0aq",
                              "data-framer-name": "Vector 1",
                              opacity: 1,
                              svg: '<svg xmlns="/2000/svg" xmlns:xlink="/1999/xlink" viewBox="0 0 612.869 1230.128"><path d="M 5.486 1225.424 C 4.572 1058.169 71.005 692.917 344.053 569.983 C 617.101 447.048 625.8 141.908 596.019 4.704" fill="transparent" stroke-width="11" stroke="var(--token-5afbb393-f5f6-4e8a-a267-062523956801, rgb(238, 195, 66))" stroke-miterlimit="10" stroke-dasharray=""></path></svg>',
                              svgContentId: 12441347657,
                              withExternalLayout: !0,
                            }),
                          ],
                        }),
                        e(Ae, {
                          href: { hash: ":U8RVzCuQJ", webPageId: "Ahpw6p2s9" },
                          motionChild: !0,
                          nodeId: "uzYgSKeCU",
                          openInNewTab: !1,
                          scopeId: "Ahpw6p2s9",
                          smoothScroll: !0,
                          children: e(na, {
                            animate: Pr,
                            className: "framer-1mw8a1g framer-1pu0e0a",
                            "data-framer-appear-id": "1mw8a1g",
                            "data-framer-name": "arrow icon",
                            initial: mr,
                            optimized: !0,
                            whileHover: Ea,
                            children: e(n, {
                              children: e(f, {
                                className: "framer-1j7iv35-container",
                                isAuthoredByUser: !0,
                                isModuleExternal: !0,
                                nodeId: "Jp6w8bD7C",
                                rendersWithMotion: !0,
                                scopeId: "Ahpw6p2s9",
                                style: { rotate: 360 },
                                children: e(V, {
                                  color:
                                    "var(--token-162cc6f1-5b31-4c9d-a955-3d5570248c76, rgb(29, 31, 19))",
                                  height: "100%",
                                  iconSearch: "House",
                                  iconSelection: "CaretDown",
                                  id: "Jp6w8bD7C",
                                  layoutId: "Jp6w8bD7C",
                                  mirrored: !1,
                                  selectByList: !0,
                                  style: { height: "100%", width: "100%" },
                                  weight: "bold",
                                  width: "100%",
                                }),
                              }),
                            }),
                          }),
                        }),
                      ],
                    }),
                    r(ye, {
                      background: {
                        alt: "",
                        fit: "fill",
                        pixelHeight: 983,
                        pixelWidth: 1512,
                        sizes: i?.width || "100vw",
                        src: "./images/JgHHGHs2w5iarAZeYfA7QhY194.png",
                        srcSet:
                          "./images/JgHHGHs2w5iarAZeYfA7QhY194.png?scale-down-to=512 512w,./images/JgHHGHs2w5iarAZeYfA7QhY194.png 1024w,./images/JgHHGHs2w5iarAZeYfA7QhY194.png 1512w",
                      },
                      className: "framer-1i6f5hz",
                      "data-framer-name": "bg gradient",
                      children: [
                        e("div", {
                          className: "framer-1wc2c8w",
                          "data-framer-name": "color",
                        }),
                        e("div", {
                          className: "framer-13zna6p",
                          "data-framer-name": "color",
                        }),
                        e("div", {
                          className: "framer-1s8ovu3",
                          "data-framer-name": "color",
                        }),
                      ],
                    }),
                  ],
                }),
                e("section", {
                  className: "framer-1yzuk16",
                  "data-border": !0,
                  "data-framer-name": "Why us",
                  id: X,
                  ref: O,
                  children: r("div", {
                    className: "framer-1ilo44i",
                    "data-framer-name": "Container",
                    children: [
                      r("div", {
                        className: "framer-1ykcc7x",
                        "data-framer-name": "heading",
                        children: [
                          e(n, {
                            height: 24,
                            children: e(f, {
                              className: "framer-1256tvp-container",
                              nodeId: "Kgn2ij3r0",
                              scopeId: "Ahpw6p2s9",
                              children: e(me, {
                                h5mTi1koL: "UNA MUTUAL CON HISTORIA",
                                height: "100%",
                                id: "Kgn2ij3r0",
                                layoutId: "Kgn2ij3r0",
                                U71_cGil4:
                                  "var(--token-3e2537c3-eabd-4676-8d1c-673071703fb4, rgb(0, 0, 0))",
                                variant: "jbNAB_7Xg",
                                width: "100%",
                                yRfDwWF7Q: "Star",
                              }),
                            }),
                          }),
                          e(w, {
                            breakpoint: c,
                            overrides: {
                              PV7eKQLeF: {
                                children: e(o, {
                                  children: e("h2", {
                                    className: "framer-styles-preset-qoet5n",
                                    "data-styles-preset": "cpwF0WKAN",
                                    style: {
                                      "--framer-text-alignment": "center",
                                    },
                                    children: "Un proyecto con impacto real",
                                  }),
                                }),
                              },
                              zH0fe2mqW: {
                                children: e(o, {
                                  children: e("h2", {
                                    className: "framer-styles-preset-qoet5n",
                                    "data-styles-preset": "cpwF0WKAN",
                                    style: {
                                      "--framer-text-alignment": "center",
                                    },
                                    children: "Un proyecto con impacto real",
                                  }),
                                }),
                              },
                            },
                            children: e(d, {
                              __fromCanvasComponent: !0,
                              children: e(o, {
                                children: e("h2", {
                                  className: "framer-styles-preset-qoet5n",
                                  "data-styles-preset": "cpwF0WKAN",
                                  style: { "--framer-text-alignment": "left" },
                                  children: "Un proyecto con impacto real",
                                }),
                              }),
                              className: "framer-8dec7i",
                              "data-framer-name": "Heading",
                              effect: $e,
                              fonts: ["Inter"],
                              verticalAlignment: "top",
                              withExternalLayout: !0,
                            }),
                          }),
                          e(w, {
                            breakpoint: c,
                            overrides: {
                              PV7eKQLeF: {
                                children: r(o, {
                                  children: [
                                    r("p", {
                                      className: "framer-styles-preset-1jigmkh",
                                      "data-styles-preset": "rgOrMEYj1",
                                      style: {
                                        "--framer-text-alignment": "center",
                                      },
                                      children: [
                                        "Desde 2003, la Asociaci\xF3n Mutual Celesol se dedica a ofrecer ",
                                        e("strong", {
                                          children:
                                            "soluciones financieras de impacto social",
                                        }),
                                        ". A trav\xE9s de Ayudas Econ\xF3micas, que se canalizan mediante nuestra ",
                                        e("strong", { children: "Red Unisol" }),
                                        ", y el programa ",
                                        e("strong", {
                                          children:
                                            "Ahorro Mutual a T\xE9rmino",
                                        }),
                                        " (AMT). Nuestra experiencia y compromiso nos han permitido consolidarnos como un ",
                                        e("strong", {
                                          children:
                                            "referente en el sector mutual",
                                        }),
                                        ". Contamos con una extensa red de convenios y alianzas estrat\xE9gicas que garantizan el acceso a herramientas financieras seguras, eficientes y alineadas con los intereses de quienes ",
                                        e("strong", {
                                          children: "conf\xEDan en nosotros",
                                        }),
                                        ".",
                                      ],
                                    }),
                                    e("p", {
                                      className: "framer-styles-preset-1jigmkh",
                                      "data-styles-preset": "rgOrMEYj1",
                                      style: {
                                        "--framer-text-alignment": "center",
                                      },
                                      children: e("br", {
                                        className: "trailing-break",
                                      }),
                                    }),
                                  ],
                                }),
                              },
                              zH0fe2mqW: {
                                children: r(o, {
                                  children: [
                                    r("p", {
                                      className: "framer-styles-preset-1jigmkh",
                                      "data-styles-preset": "rgOrMEYj1",
                                      style: {
                                        "--framer-text-alignment": "center",
                                      },
                                      children: [
                                        "Desde 2003, la Asociaci\xF3n Mutual Celesol se dedica a ofrecer ",
                                        e("strong", {
                                          children:
                                            "soluciones financieras de impacto social",
                                        }),
                                        ". A trav\xE9s de Ayudas Econ\xF3micas, que se canalizan mediante nuestra ",
                                        e("strong", { children: "Red Unisol" }),
                                        ", y el programa ",
                                        e("strong", {
                                          children:
                                            "Ahorro Mutual a T\xE9rmino",
                                        }),
                                        " (AMT). Nuestra experiencia y compromiso nos han permitido consolidarnos como un ",
                                        e("strong", {
                                          children:
                                            "referente en el sector mutual",
                                        }),
                                        ". Contamos con una extensa red de convenios y alianzas estrat\xE9gicas que garantizan el acceso a herramientas financieras seguras, eficientes y alineadas con los intereses de quienes ",
                                        e("strong", {
                                          children: "conf\xEDan en nosotros",
                                        }),
                                        ".",
                                      ],
                                    }),
                                    e("p", {
                                      className: "framer-styles-preset-1jigmkh",
                                      "data-styles-preset": "rgOrMEYj1",
                                      style: {
                                        "--framer-text-alignment": "center",
                                      },
                                      children: e("br", {
                                        className: "trailing-break",
                                      }),
                                    }),
                                  ],
                                }),
                              },
                            },
                            children: e(d, {
                              __fromCanvasComponent: !0,
                              children: r(o, {
                                children: [
                                  r("p", {
                                    className: "framer-styles-preset-1jigmkh",
                                    "data-styles-preset": "rgOrMEYj1",
                                    style: {
                                      "--framer-text-alignment": "left",
                                    },
                                    children: [
                                      "Desde 2003, la Asociaci\xF3n Mutual Celesol se dedica a ofrecer ",
                                      e("strong", {
                                        children:
                                          "soluciones financieras de impacto social",
                                      }),
                                      ". A trav\xE9s de Ayudas Econ\xF3micas, que se canalizan mediante nuestra ",
                                      e("strong", { children: "Red Unisol" }),
                                      ", y el programa ",
                                      e("strong", {
                                        children: "Ahorro Mutual a T\xE9rmino",
                                      }),
                                      " (AMT). Nuestra experiencia y compromiso nos han permitido consolidarnos como un ",
                                      e("strong", {
                                        children:
                                          "referente en el sector mutual",
                                      }),
                                      ". Contamos con una extensa red de convenios y alianzas estrat\xE9gicas que garantizan el acceso a herramientas financieras seguras, eficientes y alineadas con los intereses de quienes ",
                                      e("strong", {
                                        children: "conf\xEDan en nosotros",
                                      }),
                                      ".",
                                    ],
                                  }),
                                  e("p", {
                                    className: "framer-styles-preset-1jigmkh",
                                    "data-styles-preset": "rgOrMEYj1",
                                    style: {
                                      "--framer-text-alignment": "left",
                                    },
                                    children: e("br", {
                                      className: "trailing-break",
                                    }),
                                  }),
                                ],
                              }),
                              className: "framer-1lstr9w",
                              "data-framer-name": "Heading",
                              effect: er,
                              fonts: ["Inter", "Inter-Bold"],
                              verticalAlignment: "top",
                              withExternalLayout: !0,
                            }),
                          }),
                        ],
                      }),
                      r("div", {
                        className: "framer-5am9pe",
                        "data-framer-name": "section",
                        children: [
                          e(fr, {
                            __framer__animate: { transition: we },
                            __framer__animateOnce: !0,
                            __framer__enter: ee,
                            __framer__exit: _e,
                            __framer__styleAppearEffectEnabled: !0,
                            __framer__threshold: 0.5,
                            __perspectiveFX: !1,
                            __targetOpacity: 1,
                            className: "framer-1xviqca",
                            "data-border": !0,
                            "data-framer-name": "Card",
                            children: r("div", {
                              className: "framer-1mbn5f4",
                              "data-framer-name": "content",
                              children: [
                                r("div", {
                                  className: "framer-1038vt7",
                                  "data-framer-name": "Content",
                                  children: [
                                    e("div", {
                                      className: "framer-zrgqed",
                                      "data-framer-name": "Icon",
                                      children: e(n, {
                                        children: e(f, {
                                          className: "framer-kutybd-container",
                                          isAuthoredByUser: !0,
                                          isModuleExternal: !0,
                                          nodeId: "Ee7ou0tf5",
                                          scopeId: "Ahpw6p2s9",
                                          children: e(fe, {
                                            color:
                                              "var(--token-d49ce14e-f5dc-463a-9b8d-4f0e772df7f1, rgb(255, 255, 255))",
                                            height: "100%",
                                            iconSearch: "Verified User",
                                            iconSelection: "Group",
                                            iconStyle15: "Filled",
                                            iconStyle2: "Filled",
                                            iconStyle7: "Filled",
                                            id: "Ee7ou0tf5",
                                            layoutId: "Ee7ou0tf5",
                                            mirrored: !1,
                                            selectByList: !0,
                                            style: {
                                              height: "100%",
                                              width: "100%",
                                            },
                                            width: "100%",
                                          }),
                                        }),
                                      }),
                                    }),
                                    r("div", {
                                      className: "framer-umjzo1",
                                      "data-framer-name": "text content",
                                      children: [
                                        e(d, {
                                          __fromCanvasComponent: !0,
                                          children: e(o, {
                                            children: e("h3", {
                                              className:
                                                "framer-styles-preset-1c5jz7l",
                                              "data-styles-preset": "GiLAKWVpB",
                                              children: "Ayudas Econ\xF3micas",
                                            }),
                                          }),
                                          className: "framer-1sllrqb",
                                          fonts: ["Inter"],
                                          verticalAlignment: "top",
                                          withExternalLayout: !0,
                                        }),
                                        e(d, {
                                          __fromCanvasComponent: !0,
                                          children: e(o, {
                                            children: r("p", {
                                              className:
                                                "framer-styles-preset-149x8zz",
                                              "data-styles-preset": "oyQrFUwBY",
                                              children: [
                                                "Brindamos ",
                                                e("strong", {
                                                  children:
                                                    "pr\xE9stamos / soluciones",
                                                }),
                                                " financieras  a nuestros socios y a los socios de mutuales con las que tenemos convenios, con ",
                                                e("strong", {
                                                  children:
                                                    "tasas preferenciales",
                                                }),
                                                " y la modalidad de descuentos por haberes brindando una opci\xF3n accesible, flexible y ",
                                                e("strong", {
                                                  children: "100% Online",
                                                }),
                                                " para aquellos que necesitan un apoyo financiero",
                                              ],
                                            }),
                                          }),
                                          className: "framer-1uf1ml",
                                          "data-framer-name": "Text",
                                          fonts: ["Inter", "Inter-Bold"],
                                          verticalAlignment: "top",
                                          withExternalLayout: !0,
                                        }),
                                      ],
                                    }),
                                  ],
                                }),
                                e("div", {
                                  className: "framer-7zw2gx",
                                  "data-framer-name": "line",
                                }),
                                r("div", {
                                  className: "framer-paim16",
                                  "data-framer-name": "Content",
                                  children: [
                                    e("div", {
                                      className: "framer-xc1kba",
                                      "data-framer-name": "Icon",
                                      children: e(n, {
                                        children: e(f, {
                                          className: "framer-1kbjpvd-container",
                                          isAuthoredByUser: !0,
                                          isModuleExternal: !0,
                                          nodeId: "Us1tuNQW0",
                                          scopeId: "Ahpw6p2s9",
                                          children: e(fe, {
                                            color:
                                              "var(--token-d49ce14e-f5dc-463a-9b8d-4f0e772df7f1, rgb(255, 255, 255))",
                                            height: "100%",
                                            iconSearch: "Verified User",
                                            iconSelection: "BarChart",
                                            iconStyle15: "Filled",
                                            iconStyle2: "Filled",
                                            iconStyle7: "Filled",
                                            id: "Us1tuNQW0",
                                            layoutId: "Us1tuNQW0",
                                            mirrored: !1,
                                            selectByList: !0,
                                            style: {
                                              height: "100%",
                                              width: "100%",
                                            },
                                            width: "100%",
                                          }),
                                        }),
                                      }),
                                    }),
                                    r("div", {
                                      className: "framer-ovgtru",
                                      "data-framer-name": "text content",
                                      children: [
                                        e(d, {
                                          __fromCanvasComponent: !0,
                                          children: e(o, {
                                            children: e("h3", {
                                              className:
                                                "framer-styles-preset-1c5jz7l",
                                              "data-styles-preset": "GiLAKWVpB",
                                              children:
                                                "Ahorro Mutual a T\xE9rmino",
                                            }),
                                          }),
                                          className: "framer-jzu12z",
                                          fonts: ["Inter"],
                                          verticalAlignment: "top",
                                          withExternalLayout: !0,
                                        }),
                                        e(d, {
                                          __fromCanvasComponent: !0,
                                          children: e(o, {
                                            children: e("p", {
                                              className:
                                                "framer-styles-preset-149x8zz",
                                              "data-styles-preset": "oyQrFUwBY",
                                              children:
                                                "Es una herramienta financiera exclusiva para socios de Mutual Celesol, dise\xF1ada para personas f\xEDsicas, mutuales y entidades afines. Ofrece rentabilidad segura y estable, con tasas superiores a las del mercado, brindando una opci\xF3n confiable.",
                                            }),
                                          }),
                                          className: "framer-17q4pyd",
                                          "data-framer-name": "Text",
                                          fonts: ["Inter"],
                                          verticalAlignment: "top",
                                          withExternalLayout: !0,
                                        }),
                                      ],
                                    }),
                                  ],
                                }),
                                e("div", {
                                  className: "framer-yar60u",
                                  "data-framer-name": "line",
                                }),
                                r("div", {
                                  className: "framer-1a4fov4",
                                  "data-framer-name": "Content",
                                  children: [
                                    e("div", {
                                      className: "framer-mqd7tl",
                                      "data-framer-name": "Icon",
                                      children: e(n, {
                                        children: e(f, {
                                          className: "framer-sbca8o-container",
                                          isAuthoredByUser: !0,
                                          isModuleExternal: !0,
                                          nodeId: "audalGUDK",
                                          scopeId: "Ahpw6p2s9",
                                          children: e(fe, {
                                            color:
                                              "var(--token-d49ce14e-f5dc-463a-9b8d-4f0e772df7f1, rgb(255, 255, 255))",
                                            height: "100%",
                                            iconSearch: "Verified User",
                                            iconSelection: "Festival",
                                            iconStyle15: "Filled",
                                            iconStyle2: "Filled",
                                            iconStyle7: "Filled",
                                            id: "audalGUDK",
                                            layoutId: "audalGUDK",
                                            mirrored: !1,
                                            selectByList: !0,
                                            style: {
                                              height: "100%",
                                              width: "100%",
                                            },
                                            width: "100%",
                                          }),
                                        }),
                                      }),
                                    }),
                                    r("div", {
                                      className: "framer-y6p2q1",
                                      "data-framer-name": "text content",
                                      children: [
                                        e(d, {
                                          __fromCanvasComponent: !0,
                                          children: e(o, {
                                            children: e("h3", {
                                              className:
                                                "framer-styles-preset-1c5jz7l",
                                              "data-styles-preset": "GiLAKWVpB",
                                              children: "Red Unisol",
                                            }),
                                          }),
                                          className: "framer-1ld0whk",
                                          fonts: ["Inter"],
                                          verticalAlignment: "top",
                                          withExternalLayout: !0,
                                        }),
                                        e(d, {
                                          __fromCanvasComponent: !0,
                                          children: e(o, {
                                            children: e("p", {
                                              className:
                                                "framer-styles-preset-149x8zz",
                                              "data-styles-preset": "oyQrFUwBY",
                                              children:
                                                "Red Unisol es una agrupaci\xF3n de mutuales formada por Asociaci\xF3n Mutual Celesol y Asociaci\xF3n Mutual Fiat Concord, que ofrece servicios mutuales a los socios de ambas entidades y de las mutuales con las que mantienen convenios. Para m\xE1s informaci\xF3n, visit\xE1 nuestro sitio.",
                                            }),
                                          }),
                                          className: "framer-1amof5o",
                                          "data-framer-name": "Text",
                                          fonts: ["Inter"],
                                          verticalAlignment: "top",
                                          withExternalLayout: !0,
                                        }),
                                      ],
                                    }),
                                  ],
                                }),
                              ],
                            }),
                          }),
                          h() &&
                            e(t.div, {
                              className: "framer-stql3x hidden-1a3i2to",
                              "data-framer-name": "scribble",
                              style: { rotate: 5 },
                              children: e(C, {
                                className: "framer-hqd059",
                                "data-framer-name": "Swirls",
                                opacity: 0.33,
                                svg: '<svg xmlns="/2000/svg" xmlns:xlink="/1999/xlink" viewBox="0 0 138 71"><path d="M 15.093 2.504 C 10.111 2.504 4.866 9.409 3.622 13.936 C 1.583 21.353 1.865 29.763 2.396 37.387 C 2.942 45.217 6.058 54.867 13.23 59.128 C 18.864 62.475 28.643 63.551 35.045 62.108 C 41.261 60.707 47.98 55.498 50.291 49.601 C 51.883 45.539 51.976 39.376 49.164 35.872 C 47.14 33.351 41.362 32.762 39.016 34.945 C 35.541 38.176 32.578 42.487 31.957 47.305 C 30.98 54.879 32.343 59.722 38.967 64.013 C 47.526 69.558 61.108 69.867 70.243 66.114 C 80.467 61.914 91.319 53.518 96.323 43.543 C 98.614 38.978 99.752 34.057 100.147 28.984 C 100.374 26.069 100.846 22.283 99.167 19.701 C 96.42 15.477 90.348 14.566 86.568 18.333 C 83.062 21.827 82.577 27.862 83.92 32.452 C 84.987 36.097 89.378 38.98 92.5 40.758 C 96.527 43.051 101.977 43.426 106.52 43.396 C 119.669 43.309 129.028 30.234 135.982 20.532" fill="transparent" stroke-width="3.11" stroke="var(--token-5afbb393-f5f6-4e8a-a267-062523956801, rgb(169, 237, 66))" stroke-linecap="round" stroke-miterlimit="10"></path></svg>',
                                svgContentId: 11692656819,
                                withExternalLayout: !0,
                              }),
                            }),
                          h() &&
                            e(t.div, {
                              className: "framer-pc9dse hidden-1a3i2to",
                              "data-framer-name": "scribble",
                              style: { rotate: 184 },
                              children: e(C, {
                                className: "framer-1c1q6ku",
                                "data-framer-name": "Swirls",
                                opacity: 0.33,
                                svg: '<svg xmlns="/2000/svg" xmlns:xlink="/1999/xlink" viewBox="0 0 138 71"><path d="M 15.093 2.504 C 10.111 2.504 4.866 9.409 3.622 13.936 C 1.583 21.353 1.865 29.763 2.396 37.387 C 2.942 45.217 6.058 54.867 13.23 59.128 C 18.864 62.475 28.643 63.551 35.045 62.108 C 41.261 60.707 47.98 55.498 50.291 49.601 C 51.883 45.539 51.976 39.376 49.164 35.872 C 47.14 33.351 41.362 32.762 39.016 34.945 C 35.541 38.176 32.578 42.487 31.957 47.305 C 30.98 54.879 32.343 59.722 38.967 64.013 C 47.526 69.558 61.108 69.867 70.243 66.114 C 80.467 61.914 91.319 53.518 96.323 43.543 C 98.614 38.978 99.752 34.057 100.147 28.984 C 100.374 26.069 100.846 22.283 99.167 19.701 C 96.42 15.477 90.348 14.566 86.568 18.333 C 83.062 21.827 82.577 27.862 83.92 32.452 C 84.987 36.097 89.378 38.98 92.5 40.758 C 96.527 43.051 101.977 43.426 106.52 43.396 C 119.669 43.309 129.028 30.234 135.982 20.532" fill="transparent" stroke-width="3.11" stroke="var(--token-5afbb393-f5f6-4e8a-a267-062523956801, rgb(169, 237, 66))" stroke-linecap="round" stroke-miterlimit="10"></path></svg>',
                                svgContentId: 9742693615,
                                withExternalLayout: !0,
                              }),
                            }),
                        ],
                      }),
                      r("div", {
                        className: "framer-yaeckb",
                        "data-framer-name": "section",
                        children: [
                          e(n, {
                            children: e(f, {
                              className: "framer-9884ud-container",
                              isAuthoredByUser: !0,
                              isModuleExternal: !0,
                              nodeId: "kySoQMmjS",
                              scopeId: "Ahpw6p2s9",
                              children: e(w, {
                                breakpoint: c,
                                overrides: {
                                  PV7eKQLeF: { gap: 30 },
                                  zH0fe2mqW: { gap: 40 },
                                },
                                children: e(Re, {
                                  alignment: "center",
                                  direction: "right",
                                  fadeOptions: {
                                    fadeAlpha: 0,
                                    fadeContent: !0,
                                    fadeInset: 0,
                                    fadeWidth: 25,
                                    overflow: !1,
                                  },
                                  gap: 32,
                                  height: "100%",
                                  hoverFactor: 1,
                                  id: "kySoQMmjS",
                                  layoutId: "kySoQMmjS",
                                  padding: 10,
                                  paddingBottom: 10,
                                  paddingLeft: 10,
                                  paddingPerSide: !1,
                                  paddingRight: 10,
                                  paddingTop: 10,
                                  sizingOptions: {
                                    heightType: !0,
                                    widthType: !0,
                                  },
                                  slots: [
                                    e(n, {
                                      height: 60,
                                      width: "308.217px",
                                      children: e(f, {
                                        className: "framer-1g7fu6a-container",
                                        "data-framer-name": "AMT",
                                        inComponentSlot: !0,
                                        name: "AMT",
                                        nodeId: "XqzpyRgnv",
                                        rendersWithMotion: !0,
                                        scopeId: "Ahpw6p2s9",
                                        children: e(k, {
                                          height: "100%",
                                          id: "XqzpyRgnv",
                                          layoutId: "XqzpyRgnv",
                                          name: "AMT",
                                          ovJvdDBRs:
                                            "Regulaci\xF3n institucional mutual",
                                          width: "100%",
                                        }),
                                      }),
                                    }),
                                    e(n, {
                                      height: 60,
                                      width: "230.767px",
                                      children: e(f, {
                                        className: "framer-f1nrub-container",
                                        "data-framer-name":
                                          "Garantia de liquidez",
                                        inComponentSlot: !0,
                                        name: "Garantia de liquidez",
                                        nodeId: "NS2LdEEQr",
                                        rendersWithMotion: !0,
                                        scopeId: "Ahpw6p2s9",
                                        children: e(k, {
                                          height: "100%",
                                          id: "NS2LdEEQr",
                                          layoutId: "NS2LdEEQr",
                                          name: "Garantia de liquidez",
                                          ovJvdDBRs: "Mutualismo financiero",
                                          width: "100%",
                                        }),
                                      }),
                                    }),
                                    e(n, {
                                      height: 60,
                                      width: "330.117px",
                                      children: e(f, {
                                        className: "framer-1g9d8jx-container",
                                        "data-framer-name": "Tasa de inversion",
                                        inComponentSlot: !0,
                                        name: "Tasa de inversion",
                                        nodeId: "y3Pt5ACFJ",
                                        rendersWithMotion: !0,
                                        scopeId: "Ahpw6p2s9",
                                        children: e(k, {
                                          height: "100%",
                                          id: "y3Pt5ACFJ",
                                          layoutId: "y3Pt5ACFJ",
                                          name: "Tasa de inversion",
                                          ovJvdDBRs:
                                            "Alternativas al plazo fijo tradicional",
                                          width: "100%",
                                        }),
                                      }),
                                    }),
                                    e(n, {
                                      height: 60,
                                      width: "221.467px",
                                      children: e(f, {
                                        className: "framer-1ln14kl-container",
                                        "data-framer-name": "Patrimonio propio",
                                        inComponentSlot: !0,
                                        name: "Patrimonio propio",
                                        nodeId: "sMjkVdx2O",
                                        rendersWithMotion: !0,
                                        scopeId: "Ahpw6p2s9",
                                        children: e(k, {
                                          height: "100%",
                                          id: "sMjkVdx2O",
                                          layoutId: "sMjkVdx2O",
                                          name: "Patrimonio propio",
                                          ovJvdDBRs: "Inversiones mutuales",
                                          width: "100%",
                                        }),
                                      }),
                                    }),
                                    e(n, {
                                      height: 60,
                                      width: "251.65px",
                                      children: e(f, {
                                        className: "framer-1dvdi2x-container",
                                        "data-framer-name": "Sistema bancario",
                                        inComponentSlot: !0,
                                        name: "Sistema bancario",
                                        nodeId: "Jxc1mTM2y",
                                        rendersWithMotion: !0,
                                        scopeId: "Ahpw6p2s9",
                                        children: e(k, {
                                          height: "100%",
                                          id: "Jxc1mTM2y",
                                          layoutId: "Jxc1mTM2y",
                                          name: "Sistema bancario",
                                          ovJvdDBRs: "Instrumentos financieros",
                                          width: "100%",
                                        }),
                                      }),
                                    }),
                                    e(n, {
                                      height: 60,
                                      width: "211.6px",
                                      children: e(f, {
                                        className: "framer-1jjvva4-container",
                                        "data-framer-name": "Fondos propios",
                                        inComponentSlot: !0,
                                        name: "Fondos propios",
                                        nodeId: "vOrkEU4Oc",
                                        rendersWithMotion: !0,
                                        scopeId: "Ahpw6p2s9",
                                        children: e(k, {
                                          height: "100%",
                                          id: "vOrkEU4Oc",
                                          layoutId: "vOrkEU4Oc",
                                          name: "Fondos propios",
                                          ovJvdDBRs: "Rentabilidad segura",
                                          width: "100%",
                                        }),
                                      }),
                                    }),
                                    e(n, {
                                      height: 60,
                                      width: "235.633px",
                                      children: e(f, {
                                        className: "framer-ig32h7-container",
                                        "data-framer-name": "AMT",
                                        inComponentSlot: !0,
                                        name: "AMT",
                                        nodeId: "iQbpLpklI",
                                        rendersWithMotion: !0,
                                        scopeId: "Ahpw6p2s9",
                                        children: e(k, {
                                          height: "100%",
                                          id: "iQbpLpklI",
                                          layoutId: "iQbpLpklI",
                                          name: "AMT",
                                          ovJvdDBRs: "Transparencia y solidez",
                                          width: "100%",
                                        }),
                                      }),
                                    }),
                                  ],
                                  speed: 50,
                                  style: {
                                    height: "100%",
                                    maxWidth: "100%",
                                    width: "100%",
                                  },
                                  width: "100%",
                                }),
                              }),
                            }),
                          }),
                          e(n, {
                            children: e(f, {
                              className: "framer-eobjje-container",
                              isAuthoredByUser: !0,
                              isModuleExternal: !0,
                              nodeId: "usVrrLe_Y",
                              scopeId: "Ahpw6p2s9",
                              children: e(w, {
                                breakpoint: c,
                                overrides: {
                                  PV7eKQLeF: { gap: 30 },
                                  zH0fe2mqW: { gap: 40 },
                                },
                                children: e(Re, {
                                  alignment: "center",
                                  direction: "left",
                                  fadeOptions: {
                                    fadeAlpha: 0,
                                    fadeContent: !0,
                                    fadeInset: 0,
                                    fadeWidth: 25,
                                    overflow: !1,
                                  },
                                  gap: 32,
                                  height: "100%",
                                  hoverFactor: 1,
                                  id: "usVrrLe_Y",
                                  layoutId: "usVrrLe_Y",
                                  padding: 10,
                                  paddingBottom: 10,
                                  paddingLeft: 10,
                                  paddingPerSide: !1,
                                  paddingRight: 10,
                                  paddingTop: 10,
                                  sizingOptions: {
                                    heightType: !0,
                                    widthType: !0,
                                  },
                                  slots: [
                                    e(n, {
                                      height: 60,
                                      width: "308.217px",
                                      children: e(f, {
                                        className: "framer-1g7fu6a-container",
                                        "data-framer-name": "AMT",
                                        inComponentSlot: !0,
                                        name: "AMT",
                                        nodeId: "XqzpyRgnv",
                                        rendersWithMotion: !0,
                                        scopeId: "Ahpw6p2s9",
                                        children: e(k, {
                                          height: "100%",
                                          id: "XqzpyRgnv",
                                          layoutId: "XqzpyRgnv",
                                          name: "AMT",
                                          ovJvdDBRs:
                                            "Regulaci\xF3n institucional mutual",
                                          width: "100%",
                                        }),
                                      }),
                                    }),
                                    e(n, {
                                      height: 60,
                                      width: "221.467px",
                                      children: e(f, {
                                        className: "framer-1ln14kl-container",
                                        "data-framer-name": "Patrimonio propio",
                                        inComponentSlot: !0,
                                        name: "Patrimonio propio",
                                        nodeId: "sMjkVdx2O",
                                        rendersWithMotion: !0,
                                        scopeId: "Ahpw6p2s9",
                                        children: e(k, {
                                          height: "100%",
                                          id: "sMjkVdx2O",
                                          layoutId: "sMjkVdx2O",
                                          name: "Patrimonio propio",
                                          ovJvdDBRs: "Inversiones mutuales",
                                          width: "100%",
                                        }),
                                      }),
                                    }),
                                    e(n, {
                                      height: 60,
                                      width: "251.65px",
                                      children: e(f, {
                                        className: "framer-1dvdi2x-container",
                                        "data-framer-name": "Sistema bancario",
                                        inComponentSlot: !0,
                                        name: "Sistema bancario",
                                        nodeId: "Jxc1mTM2y",
                                        rendersWithMotion: !0,
                                        scopeId: "Ahpw6p2s9",
                                        children: e(k, {
                                          height: "100%",
                                          id: "Jxc1mTM2y",
                                          layoutId: "Jxc1mTM2y",
                                          name: "Sistema bancario",
                                          ovJvdDBRs: "Instrumentos financieros",
                                          width: "100%",
                                        }),
                                      }),
                                    }),
                                    e(n, {
                                      height: 60,
                                      width: "211.6px",
                                      children: e(f, {
                                        className: "framer-1jjvva4-container",
                                        "data-framer-name": "Fondos propios",
                                        inComponentSlot: !0,
                                        name: "Fondos propios",
                                        nodeId: "vOrkEU4Oc",
                                        rendersWithMotion: !0,
                                        scopeId: "Ahpw6p2s9",
                                        children: e(k, {
                                          height: "100%",
                                          id: "vOrkEU4Oc",
                                          layoutId: "vOrkEU4Oc",
                                          name: "Fondos propios",
                                          ovJvdDBRs: "Rentabilidad segura",
                                          width: "100%",
                                        }),
                                      }),
                                    }),
                                    e(n, {
                                      height: 60,
                                      width: "330.117px",
                                      children: e(f, {
                                        className: "framer-1g9d8jx-container",
                                        "data-framer-name": "Tasa de inversion",
                                        inComponentSlot: !0,
                                        name: "Tasa de inversion",
                                        nodeId: "y3Pt5ACFJ",
                                        rendersWithMotion: !0,
                                        scopeId: "Ahpw6p2s9",
                                        children: e(k, {
                                          height: "100%",
                                          id: "y3Pt5ACFJ",
                                          layoutId: "y3Pt5ACFJ",
                                          name: "Tasa de inversion",
                                          ovJvdDBRs:
                                            "Alternativas al plazo fijo tradicional",
                                          width: "100%",
                                        }),
                                      }),
                                    }),
                                    e(n, {
                                      height: 60,
                                      width: "230.767px",
                                      children: e(f, {
                                        className: "framer-f1nrub-container",
                                        "data-framer-name":
                                          "Garantia de liquidez",
                                        inComponentSlot: !0,
                                        name: "Garantia de liquidez",
                                        nodeId: "NS2LdEEQr",
                                        rendersWithMotion: !0,
                                        scopeId: "Ahpw6p2s9",
                                        children: e(k, {
                                          height: "100%",
                                          id: "NS2LdEEQr",
                                          layoutId: "NS2LdEEQr",
                                          name: "Garantia de liquidez",
                                          ovJvdDBRs: "Mutualismo financiero",
                                          width: "100%",
                                        }),
                                      }),
                                    }),
                                  ],
                                  speed: 50,
                                  style: {
                                    height: "100%",
                                    maxWidth: "100%",
                                    width: "100%",
                                  },
                                  width: "100%",
                                }),
                              }),
                            }),
                          }),
                        ],
                      }),
                    ],
                  }),
                }),
                e(n, {
                  height: 559,
                  width: i?.width || "100vw",
                  children: e(f, {
                    className: "framer-1l6n183-container",
                    id: U,
                    nodeId: "Cg0eq09PA",
                    ref: le,
                    scopeId: "Ahpw6p2s9",
                    children: e(w, {
                      breakpoint: c,
                      overrides: {
                        PV7eKQLeF: { variant: "ViY0k6XSo" },
                        zH0fe2mqW: { variant: "q9BW4xksx" },
                      },
                      children: e(dr, {
                        height: "100%",
                        id: "Cg0eq09PA",
                        layoutId: "Cg0eq09PA",
                        q2ZLvvoNH:
                          "https://b24-nh2s2f.bitrix24.site/crm_form_otokd/",
                        style: { width: "100%" },
                        variant: "hQk71P6gN",
                        width: "100%",
                      }),
                    }),
                  }),
                }),
                r("div", {
                  className: "framer-3q637b",
                  "data-border": !0,
                  "data-framer-name": "Pricing",
                  id: ne,
                  ref: hr,
                  children: [
                    r("div", {
                      className: "framer-yq1sjd",
                      "data-framer-name": "container",
                      children: [
                        r("div", {
                          className: "framer-y2gxbc",
                          "data-framer-name": "heading",
                          children: [
                            e(n, {
                              height: 24,
                              children: e(f, {
                                className: "framer-wjiinw-container",
                                nodeId: "YtRXuMIM3",
                                scopeId: "Ahpw6p2s9",
                                children: e(me, {
                                  h5mTi1koL: "AMT",
                                  height: "100%",
                                  id: "YtRXuMIM3",
                                  layoutId: "YtRXuMIM3",
                                  U71_cGil4:
                                    "var(--token-162cc6f1-5b31-4c9d-a955-3d5570248c76, rgb(23, 36, 61))",
                                  variant: "jbNAB_7Xg",
                                  width: "100%",
                                  yRfDwWF7Q: "ChartBar",
                                }),
                              }),
                            }),
                            e(d, {
                              __fromCanvasComponent: !0,
                              children: e(o, {
                                children: e("h2", {
                                  className: "framer-styles-preset-qoet5n",
                                  "data-styles-preset": "cpwF0WKAN",
                                  children: "Ahorro mutual a t\xE9rmino",
                                }),
                              }),
                              className: "framer-drkz2c",
                              effect: $e,
                              fonts: ["Inter"],
                              verticalAlignment: "top",
                              withExternalLayout: !0,
                            }),
                            e(d, {
                              __fromCanvasComponent: !0,
                              children: e(o, {
                                children: r("p", {
                                  className: "framer-styles-preset-1jigmkh",
                                  "data-styles-preset": "rgOrMEYj1",
                                  children: [
                                    e("strong", { children: "Nuestras tasas" }),
                                    " se destacan por tres factores clave: ",
                                    e("strong", {
                                      children: "eficiencia fiscal",
                                    }),
                                    " que nos permite ofrecer mejores rendimientos al no aplicar IVA sobre intereses, un ",
                                    e("strong", {
                                      children:
                                        "modelo de inversi\xF3n seguro y rentable",
                                    }),
                                    " basado en pr\xE9stamos con descuento directo a empleados p\xFAblicos, y una garant\xEDa de ",
                                    e("strong", {
                                      children: "liquidez respaldada",
                                    }),
                                    " por un fondo estrat\xE9gico en el mercado de capitales. Esto se traduce en m\xE1s rentabilidad, menos riesgo y una mejor inversi\xF3n para nuestros socios.",
                                  ],
                                }),
                              }),
                              className: "framer-4lobi",
                              effect: er,
                              fonts: ["Inter", "Inter-Bold"],
                              verticalAlignment: "top",
                              withExternalLayout: !0,
                            }),
                          ],
                        }),
                        r("div", {
                          className: "framer-1xt1wio",
                          "data-framer-name": "section",
                          children: [
                            e(w, {
                              breakpoint: c,
                              overrides: {
                                PV7eKQLeF: {
                                  width: `min(max(${i?.width || "100vw"} - 40px, 1px), 1240px)`,
                                },
                                zH0fe2mqW: {
                                  width: `min(max(${i?.width || "100vw"} - 80px, 1px), 1240px)`,
                                },
                              },
                              children: e(n, {
                                height: 436,
                                width: `min(max(${i?.width || "100vw"} - 120px, 1px), 1240px)`,
                                children: e(Ie, {
                                  __framer__animate: { transition: we },
                                  __framer__animateOnce: !0,
                                  __framer__enter: ee,
                                  __framer__exit: _e,
                                  __framer__styleAppearEffectEnabled: !0,
                                  __framer__threshold: 0.5,
                                  __perspectiveFX: !1,
                                  __targetOpacity: 1,
                                  className: "framer-pu5m8w-container",
                                  nodeId: "UWHkS8zcG",
                                  rendersWithMotion: !0,
                                  scopeId: "Ahpw6p2s9",
                                  children: e(Ze, {
                                    aqjDFNtSh: "Si represent\xE1s a una mutual",
                                    EvqyuZXFQ:
                                      "Soluciones adaptadas al sector mutual",
                                    fOsmDMmXP:
                                      "Pensado para entidades que desean rentabilizar su capital con respaldo y seguridad:",
                                    GQONxYmTc: "",
                                    height: "100%",
                                    id: "UWHkS8zcG",
                                    layoutId: "UWHkS8zcG",
                                    NTCCp42Ny: "AMT para Mutuales",
                                    style: { width: "100%" },
                                    variant: "tzVoubfhQ",
                                    width: "100%",
                                    WNbhzSMBJ:
                                      "Los mejores rendimientos del mercado.",
                                    y5thXLVlQ:
                                      "Asesoramiento financiero personalizado",
                                    yTPGGjUXP:
                                      "https://b24-nh2s2f.bitrix24.site/crm_form_otokd/",
                                  }),
                                }),
                              }),
                            }),
                            e(w, {
                              breakpoint: c,
                              overrides: {
                                PV7eKQLeF: {
                                  width: `min(max(${i?.width || "100vw"} - 40px, 1px), 1240px)`,
                                },
                                zH0fe2mqW: {
                                  width: `min(max(${i?.width || "100vw"} - 80px, 1px), 1240px)`,
                                },
                              },
                              children: e(n, {
                                height: 436,
                                width: `min(max(${i?.width || "100vw"} - 120px, 1px), 1240px)`,
                                children: e(Ie, {
                                  __framer__animate: { transition: cr },
                                  __framer__animateOnce: !0,
                                  __framer__enter: ee,
                                  __framer__exit: Qr,
                                  __framer__styleAppearEffectEnabled: !0,
                                  __framer__threshold: 0.5,
                                  __perspectiveFX: !1,
                                  __targetOpacity: 1,
                                  className: "framer-29p146-container",
                                  nodeId: "h0loUBIvM",
                                  rendersWithMotion: !0,
                                  scopeId: "Ahpw6p2s9",
                                  children: e(Ze, {
                                    aqjDFNtSh:
                                      "Si busc\xE1s rentabilizar tu capital",
                                    EvqyuZXFQ:
                                      "Transparencia en cada operaci\xF3n",
                                    fOsmDMmXP:
                                      "Ideal para personas asociadas \u2014o interesadas en asociarse\u2014 de manera particular.",
                                    GQONxYmTc: "",
                                    height: "100%",
                                    id: "h0loUBIvM",
                                    layoutId: "h0loUBIvM",
                                    NTCCp42Ny: "AMT para personas asociadas",
                                    style: { width: "100%" },
                                    variant: "tzVoubfhQ",
                                    width: "100%",
                                    WNbhzSMBJ: "Tasas competitivas",
                                    y5thXLVlQ: "100% online",
                                    yTPGGjUXP:
                                      "https://b24-nh2s2f.bitrix24.site/crm_form_otokd/",
                                  }),
                                }),
                              }),
                            }),
                            h() &&
                              e(t.div, {
                                className: "framer-htgykz hidden-1a3i2to",
                                "data-framer-name": "scribble",
                                style: { rotate: 5 },
                                children: e(C, {
                                  className: "framer-em36xr",
                                  "data-framer-name": "Swirls",
                                  opacity: 0.33,
                                  svg: '<svg xmlns="/2000/svg" xmlns:xlink="/1999/xlink" viewBox="0 0 138 71"><path d="M 15.093 2.504 C 10.111 2.504 4.866 9.409 3.622 13.936 C 1.583 21.353 1.865 29.763 2.396 37.387 C 2.942 45.217 6.058 54.867 13.23 59.128 C 18.864 62.475 28.643 63.551 35.045 62.108 C 41.261 60.707 47.98 55.498 50.291 49.601 C 51.883 45.539 51.976 39.376 49.164 35.872 C 47.14 33.351 41.362 32.762 39.016 34.945 C 35.541 38.176 32.578 42.487 31.957 47.305 C 30.98 54.879 32.343 59.722 38.967 64.013 C 47.526 69.558 61.108 69.867 70.243 66.114 C 80.467 61.914 91.319 53.518 96.323 43.543 C 98.614 38.978 99.752 34.057 100.147 28.984 C 100.374 26.069 100.846 22.283 99.167 19.701 C 96.42 15.477 90.348 14.566 86.568 18.333 C 83.062 21.827 82.577 27.862 83.92 32.452 C 84.987 36.097 89.378 38.98 92.5 40.758 C 96.527 43.051 101.977 43.426 106.52 43.396 C 119.669 43.309 129.028 30.234 135.982 20.532" fill="transparent" stroke-width="3.11" stroke="var(--token-5afbb393-f5f6-4e8a-a267-062523956801, rgb(169, 237, 66))" stroke-linecap="round" stroke-miterlimit="10"></path></svg>',
                                  svgContentId: 9742693615,
                                  withExternalLayout: !0,
                                }),
                              }),
                          ],
                        }),
                        e("div", {
                          className: "framer-1kgo11a",
                          "data-framer-name": "section",
                          children: r("div", {
                            className: "framer-11ity0d",
                            "data-framer-name": "div",
                            children: [
                              r("div", {
                                className: "framer-1pcq7ay",
                                "data-framer-name": "icon & text",
                                children: [
                                  e(n, {
                                    children: e(f, {
                                      className: "framer-1d4hqw2-container",
                                      isAuthoredByUser: !0,
                                      isModuleExternal: !0,
                                      nodeId: "FCdjdvxz8",
                                      scopeId: "Ahpw6p2s9",
                                      children: e(V, {
                                        color:
                                          "var(--token-162cc6f1-5b31-4c9d-a955-3d5570248c76, rgb(29, 31, 19))",
                                        height: "100%",
                                        iconSearch: "House",
                                        iconSelection: "ShieldCheck",
                                        id: "FCdjdvxz8",
                                        layoutId: "FCdjdvxz8",
                                        mirrored: !1,
                                        selectByList: !0,
                                        style: {
                                          height: "100%",
                                          width: "100%",
                                        },
                                        weight: "regular",
                                        width: "100%",
                                      }),
                                    }),
                                  }),
                                  e(d, {
                                    __fromCanvasComponent: !0,
                                    children: e(o, {
                                      children: e("p", {
                                        className:
                                          "framer-styles-preset-1jigmkh",
                                        "data-styles-preset": "rgOrMEYj1",
                                        children: "Inversi\xF3n segura",
                                      }),
                                    }),
                                    className: "framer-t4o3go",
                                    fonts: ["Inter"],
                                    verticalAlignment: "top",
                                    withExternalLayout: !0,
                                  }),
                                ],
                              }),
                              r("div", {
                                className: "framer-1jj1a9s",
                                "data-framer-name": "icon & text",
                                children: [
                                  e(n, {
                                    children: e(f, {
                                      className: "framer-1ahidaj-container",
                                      isAuthoredByUser: !0,
                                      isModuleExternal: !0,
                                      nodeId: "Orm1L2vp5",
                                      scopeId: "Ahpw6p2s9",
                                      children: e(V, {
                                        color:
                                          "var(--token-162cc6f1-5b31-4c9d-a955-3d5570248c76, rgb(29, 31, 19))",
                                        height: "100%",
                                        iconSearch: "House",
                                        iconSelection: "CheckCircle",
                                        id: "Orm1L2vp5",
                                        layoutId: "Orm1L2vp5",
                                        mirrored: !1,
                                        selectByList: !0,
                                        style: {
                                          height: "100%",
                                          width: "100%",
                                        },
                                        weight: "regular",
                                        width: "100%",
                                      }),
                                    }),
                                  }),
                                  e(d, {
                                    __fromCanvasComponent: !0,
                                    children: e(o, {
                                      children: e("p", {
                                        className:
                                          "framer-styles-preset-1jigmkh",
                                        "data-styles-preset": "rgOrMEYj1",
                                        children: "Asesoramiento personalizado",
                                      }),
                                    }),
                                    className: "framer-1bbxlc2",
                                    fonts: ["Inter"],
                                    verticalAlignment: "top",
                                    withExternalLayout: !0,
                                  }),
                                ],
                              }),
                              r("div", {
                                className: "framer-1h36qo7",
                                "data-framer-name": "icon & text",
                                children: [
                                  e(n, {
                                    children: e(f, {
                                      className: "framer-2nkzf2-container",
                                      isAuthoredByUser: !0,
                                      isModuleExternal: !0,
                                      nodeId: "ktE_fV8HV",
                                      scopeId: "Ahpw6p2s9",
                                      children: e(fe, {
                                        color:
                                          "var(--token-3e2537c3-eabd-4676-8d1c-673071703fb4, rgb(0, 0, 0))",
                                        height: "100%",
                                        iconSearch: "Verified User",
                                        iconSelection: "BarChart",
                                        iconStyle15: "Filled",
                                        iconStyle2: "Filled",
                                        iconStyle7: "Filled",
                                        id: "ktE_fV8HV",
                                        layoutId: "ktE_fV8HV",
                                        mirrored: !1,
                                        selectByList: !0,
                                        style: {
                                          height: "100%",
                                          width: "100%",
                                        },
                                        width: "100%",
                                      }),
                                    }),
                                  }),
                                  e(d, {
                                    __fromCanvasComponent: !0,
                                    children: e(o, {
                                      children: e("p", {
                                        className:
                                          "framer-styles-preset-1jigmkh",
                                        "data-styles-preset": "rgOrMEYj1",
                                        children: "El mejor rendimiento",
                                      }),
                                    }),
                                    className: "framer-9abrok",
                                    fonts: ["Inter"],
                                    verticalAlignment: "top",
                                    withExternalLayout: !0,
                                  }),
                                ],
                              }),
                            ],
                          }),
                        }),
                        r("div", {
                          className: "framer-1s18s58",
                          "data-framer-name": "section",
                          children: [
                            r(fr, {
                              __framer__animate: { transition: we },
                              __framer__animateOnce: !0,
                              __framer__enter: ee,
                              __framer__exit: _e,
                              __framer__styleAppearEffectEnabled: !0,
                              __framer__threshold: 0.5,
                              __perspectiveFX: !1,
                              __targetOpacity: 1,
                              className: "framer-1llt0cq",
                              "data-framer-name": "div",
                              children: [
                                e(d, {
                                  __fromCanvasComponent: !0,
                                  children: e(o, {
                                    children: e("h3", {
                                      className: "framer-styles-preset-1c5jz7l",
                                      "data-styles-preset": "GiLAKWVpB",
                                      style: {
                                        "--framer-text-alignment": "center",
                                      },
                                      children:
                                        "\xBFQuer\xE9s saber si AMT se adapta a tus objetivos?",
                                    }),
                                  }),
                                  className: "framer-1b27k81",
                                  fonts: ["Inter"],
                                  verticalAlignment: "top",
                                  withExternalLayout: !0,
                                }),
                                e(d, {
                                  __fromCanvasComponent: !0,
                                  children: e(o, {
                                    children: e("p", {
                                      className: "framer-styles-preset-q9uths",
                                      "data-styles-preset": "RKGxIaBMW",
                                      children:
                                        "Ofrecemos asistencia personalizada, podemos coordinar una reuni\xF3n y resolver todas sus dudas",
                                    }),
                                  }),
                                  className: "framer-xap9ij",
                                  fonts: ["Inter"],
                                  verticalAlignment: "top",
                                  withExternalLayout: !0,
                                }),
                                e(n, {
                                  height: 52,
                                  children: e(f, {
                                    className: "framer-10xysex-container",
                                    nodeId: "ByMAIL5gJ",
                                    scopeId: "Ahpw6p2s9",
                                    children: e(R, {
                                      cRoeZpcrs: "Coordinar una reuni\xF3n",
                                      FsefAOOPs:
                                        "var(--token-94539f16-8480-49c8-9a5c-337b3e6187f6, rgb(247, 248, 245))",
                                      GrpQ8zFBL:
                                        "https://b24-nh2s2f.bitrix24.site/crm_form_otokd/",
                                      height: "100%",
                                      id: "ByMAIL5gJ",
                                      layoutId: "ByMAIL5gJ",
                                      RCPR2dydG: "Crown",
                                      SM93ZbT4W: !1,
                                      variant: "PmpqUdVKb",
                                      width: "100%",
                                    }),
                                  }),
                                }),
                              ],
                            }),
                            h() &&
                              e(t.div, {
                                className: "framer-1rnyb30 hidden-1a3i2to",
                                "data-framer-name": "scribble",
                                style: { rotate: 184 },
                                children: e(C, {
                                  className: "framer-3nmjld",
                                  "data-framer-name": "Swirls",
                                  opacity: 0.33,
                                  svg: '<svg xmlns="/2000/svg" xmlns:xlink="/1999/xlink" viewBox="0 0 138 71"><path d="M 15.093 2.504 C 10.111 2.504 4.866 9.409 3.622 13.936 C 1.583 21.353 1.865 29.763 2.396 37.387 C 2.942 45.217 6.058 54.867 13.23 59.128 C 18.864 62.475 28.643 63.551 35.045 62.108 C 41.261 60.707 47.98 55.498 50.291 49.601 C 51.883 45.539 51.976 39.376 49.164 35.872 C 47.14 33.351 41.362 32.762 39.016 34.945 C 35.541 38.176 32.578 42.487 31.957 47.305 C 30.98 54.879 32.343 59.722 38.967 64.013 C 47.526 69.558 61.108 69.867 70.243 66.114 C 80.467 61.914 91.319 53.518 96.323 43.543 C 98.614 38.978 99.752 34.057 100.147 28.984 C 100.374 26.069 100.846 22.283 99.167 19.701 C 96.42 15.477 90.348 14.566 86.568 18.333 C 83.062 21.827 82.577 27.862 83.92 32.452 C 84.987 36.097 89.378 38.98 92.5 40.758 C 96.527 43.051 101.977 43.426 106.52 43.396 C 119.669 43.309 129.028 30.234 135.982 20.532" fill="transparent" stroke-width="3.11" stroke="var(--token-5afbb393-f5f6-4e8a-a267-062523956801, rgb(169, 237, 66))" stroke-linecap="round" stroke-miterlimit="10"></path></svg>',
                                  svgContentId: 9742693615,
                                  withExternalLayout: !0,
                                }),
                              }),
                          ],
                        }),
                      ],
                    }),
                    r("div", {
                      className: "framer-8slvbf",
                      "data-framer-name": "bg gradient",
                      children: [
                        e("div", {
                          className: "framer-of0s7s",
                          "data-framer-name": "color",
                        }),
                        e("div", {
                          className: "framer-86lf4",
                          "data-framer-name": "color",
                        }),
                        e("div", {
                          className: "framer-i89ici",
                          "data-framer-name": "color",
                        }),
                      ],
                    }),
                  ],
                }),
                r("div", {
                  className: "framer-18x17iz",
                  "data-framer-name": "Reviews",
                  id: ur,
                  ref: Ue,
                  children: [
                    r("div", {
                      className: "framer-qi28bb",
                      "data-framer-name": "container",
                      children: [
                        r("div", {
                          className: "framer-idbir2",
                          "data-framer-name": "heading",
                          children: [
                            e(n, {
                              height: 24,
                              children: e(f, {
                                className: "framer-13z1yt4-container",
                                nodeId: "aYgAVsmVj",
                                scopeId: "Ahpw6p2s9",
                                children: e(me, {
                                  h5mTi1koL: "OPINIONES",
                                  height: "100%",
                                  id: "aYgAVsmVj",
                                  layoutId: "aYgAVsmVj",
                                  U71_cGil4:
                                    "var(--token-5afbb393-f5f6-4e8a-a267-062523956801, rgb(169, 237, 66))",
                                  variant: "jbNAB_7Xg",
                                  width: "100%",
                                  yRfDwWF7Q: "UsersThree",
                                }),
                              }),
                            }),
                            e(d, {
                              __fromCanvasComponent: !0,
                              children: e(o, {
                                children: e("h2", {
                                  className: "framer-styles-preset-qoet5n",
                                  "data-styles-preset": "cpwF0WKAN",
                                  children: "Nuestros socios nos respaldan",
                                }),
                              }),
                              className: "framer-1v9n0cq",
                              "data-framer-name": "Let\u2019s Stay Connected",
                              effect: $e,
                              fonts: ["Inter"],
                              verticalAlignment: "top",
                              withExternalLayout: !0,
                            }),
                            e(d, {
                              __fromCanvasComponent: !0,
                              children: e(o, {
                                children: e("p", {
                                  className: "framer-styles-preset-1jigmkh",
                                  "data-styles-preset": "rgOrMEYj1",
                                  children:
                                    "Como una de las mutuales referentes del mercado, nos importa la opci\xF3n de nuestros socios. Conozca algunas de ellas",
                                }),
                              }),
                              className: "framer-1ctw3kr",
                              "data-framer-name": "paragraph",
                              effect: er,
                              fonts: ["Inter"],
                              verticalAlignment: "top",
                              withExternalLayout: !0,
                            }),
                          ],
                        }),
                        r("div", {
                          className: "framer-jei5en",
                          "data-framer-name": "section",
                          children: [
                            e("div", {
                              className: "framer-1wdidps",
                              "data-framer-name": "review div",
                              children: e(w, {
                                breakpoint: c,
                                overrides: {
                                  PV7eKQLeF: {
                                    width: `min(min(max(${i?.width || "100vw"} - 40px, 1px), 1240px), 440px)`,
                                  },
                                  zH0fe2mqW: {
                                    width: `min(max(${i?.width || "100vw"} - 80px, 1px), 1240px)`,
                                  },
                                },
                                children: e(n, {
                                  height: 197,
                                  width: `min(min(max(${i?.width || "100vw"} - 120px, 1px), 1240px), 440px)`,
                                  children: e(Ie, {
                                    __framer__animate: { transition: we },
                                    __framer__animateOnce: !0,
                                    __framer__enter: ee,
                                    __framer__exit: _e,
                                    __framer__styleAppearEffectEnabled: !0,
                                    __framer__threshold: 0.5,
                                    __perspectiveFX: !1,
                                    __targetOpacity: 1,
                                    className: "framer-1mybq54-container",
                                    nodeId: "XgpT8YKKa",
                                    rendersWithMotion: !0,
                                    scopeId: "Ahpw6p2s9",
                                    children: e(Fe, {
                                      height: "100%",
                                      id: "XgpT8YKKa",
                                      layoutId: "XgpT8YKKa",
                                      odyoCEm6_: "Ignacio Bacsay",
                                      RQnxNmsAq:
                                        "Est\xE1n muy encima, hay que felicitarlos porque est\xE1n encima tuyo, te escriben, te llaman como 'ven\xED, acordate de esto, acordate de aquello', te hacen los pagos r\xE1pido, en el d\xEDa, en eso la verdad que s\xFAper bien.",
                                      style: { width: "100%" },
                                      width: "100%",
                                    }),
                                  }),
                                }),
                              }),
                            }),
                            e("div", {
                              className: "framer-mn4tq1",
                              "data-framer-name": "review div",
                              children: e(w, {
                                breakpoint: c,
                                overrides: {
                                  PV7eKQLeF: {
                                    width: `min(min(max(${i?.width || "100vw"} - 40px, 1px), 1240px), 440px)`,
                                  },
                                  zH0fe2mqW: {
                                    width: `min(max(${i?.width || "100vw"} - 80px, 1px), 1240px)`,
                                  },
                                },
                                children: e(n, {
                                  height: 197,
                                  width: `min(min(max(${i?.width || "100vw"} - 120px, 1px), 1240px), 440px)`,
                                  children: e(Ie, {
                                    __framer__animate: { transition: Yr },
                                    __framer__animateOnce: !0,
                                    __framer__enter: ee,
                                    __framer__exit: Ma,
                                    __framer__styleAppearEffectEnabled: !0,
                                    __framer__threshold: 0.5,
                                    __perspectiveFX: !1,
                                    __targetOpacity: 1,
                                    className: "framer-ctcugq-container",
                                    nodeId: "NLtCZfygg",
                                    rendersWithMotion: !0,
                                    scopeId: "Ahpw6p2s9",
                                    children: e(Fe, {
                                      height: "100%",
                                      id: "NLtCZfygg",
                                      layoutId: "NLtCZfygg",
                                      odyoCEm6_:
                                        "Marcelo Dur\xE1n, Dirigente de Mutual e Inversor de AMT.",
                                      RQnxNmsAq:
                                        "Como instituci\xF3n, creemos que cuando las propuestas son serias como en este caso donde hay atr\xE1s todo una responsabilidad, profesionales que se manejan bien, es muy bueno, es para crecer enormemente.",
                                      style: { width: "100%" },
                                      width: "100%",
                                    }),
                                  }),
                                }),
                              }),
                            }),
                            e("div", {
                              className: "framer-15uy15h",
                              "data-framer-name": "review div",
                              children: e(w, {
                                breakpoint: c,
                                overrides: {
                                  PV7eKQLeF: {
                                    width: `min(min(max(${i?.width || "100vw"} - 40px, 1px), 1240px), 440px)`,
                                  },
                                  zH0fe2mqW: {
                                    width: `min(max(${i?.width || "100vw"} - 80px, 1px), 1240px)`,
                                  },
                                },
                                children: e(n, {
                                  height: 197,
                                  width: `min(min(max(${i?.width || "100vw"} - 120px, 1px), 1240px), 440px)`,
                                  children: e(Ie, {
                                    __framer__animate: { transition: cr },
                                    __framer__animateOnce: !0,
                                    __framer__enter: ee,
                                    __framer__exit: Qr,
                                    __framer__styleAppearEffectEnabled: !0,
                                    __framer__threshold: 0.5,
                                    __perspectiveFX: !1,
                                    __targetOpacity: 1,
                                    className: "framer-ap7khv-container",
                                    nodeId: "BQ8_g14tS",
                                    rendersWithMotion: !0,
                                    scopeId: "Ahpw6p2s9",
                                    children: e(Fe, {
                                      height: "100%",
                                      id: "BQ8_g14tS",
                                      layoutId: "BQ8_g14tS",
                                      odyoCEm6_: "Hernan Massimino",
                                      RQnxNmsAq:
                                        "El valor de invertir en otra mutual es el crecimiento conjunto y el apoyo mutuo. Nos permite hacernos crecer entre nosotros, como parte de la gran familia mutualista",
                                      style: { width: "100%" },
                                      width: "100%",
                                    }),
                                  }),
                                }),
                              }),
                            }),
                          ],
                        }),
                      ],
                    }),
                    r("div", {
                      className: "framer-msnne0",
                      "data-framer-name": "bg gradient",
                      children: [
                        e("div", {
                          className: "framer-1rrjsx4",
                          "data-framer-name": "color",
                        }),
                        e("div", {
                          className: "framer-1n7i801",
                          "data-framer-name": "color",
                        }),
                        e("div", {
                          className: "framer-6o41zt",
                          "data-framer-name": "color",
                        }),
                      ],
                    }),
                    h() &&
                      e(t.div, {
                        className: "framer-1q8114m hidden-1a3i2to",
                        "data-framer-name": "scribble",
                        style: { rotate: 209 },
                        children: e(C, {
                          className: "framer-gt3ckj",
                          "data-framer-name": "Swirls",
                          opacity: 0.33,
                          svg: '<svg xmlns="/2000/svg" xmlns:xlink="/1999/xlink" viewBox="0 0 138 71"><path d="M 15.093 2.504 C 10.111 2.504 4.866 9.409 3.622 13.936 C 1.583 21.353 1.865 29.763 2.396 37.387 C 2.942 45.217 6.058 54.867 13.23 59.128 C 18.864 62.475 28.643 63.551 35.045 62.108 C 41.261 60.707 47.98 55.498 50.291 49.601 C 51.883 45.539 51.976 39.376 49.164 35.872 C 47.14 33.351 41.362 32.762 39.016 34.945 C 35.541 38.176 32.578 42.487 31.957 47.305 C 30.98 54.879 32.343 59.722 38.967 64.013 C 47.526 69.558 61.108 69.867 70.243 66.114 C 80.467 61.914 91.319 53.518 96.323 43.543 C 98.614 38.978 99.752 34.057 100.147 28.984 C 100.374 26.069 100.846 22.283 99.167 19.701 C 96.42 15.477 90.348 14.566 86.568 18.333 C 83.062 21.827 82.577 27.862 83.92 32.452 C 84.987 36.097 89.378 38.98 92.5 40.758 C 96.527 43.051 101.977 43.426 106.52 43.396 C 119.669 43.309 129.028 30.234 135.982 20.532" fill="transparent" stroke-width="3.11" stroke="var(--token-5afbb393-f5f6-4e8a-a267-062523956801, rgb(169, 237, 66))" stroke-linecap="round" stroke-miterlimit="10"></path></svg>',
                          svgContentId: 9742693615,
                          withExternalLayout: !0,
                        }),
                      }),
                  ],
                }),
                r("div", {
                  className: "framer-1fzk25t",
                  "data-framer-name": "Footer",
                  children: [
                    r("div", {
                      className: "framer-1ajochk",
                      "data-border": !0,
                      "data-framer-name": "Faq's",
                      id: g,
                      ref: xr,
                      children: [
                        r("div", {
                          className: "framer-bc593k",
                          "data-framer-name": "container",
                          children: [
                            r("div", {
                              className: "framer-877ltl",
                              "data-framer-name": "heading",
                              children: [
                                e(n, {
                                  height: 24,
                                  children: e(f, {
                                    className: "framer-1g4rlu5-container",
                                    nodeId: "J6gWqCS8d",
                                    scopeId: "Ahpw6p2s9",
                                    children: e(me, {
                                      h5mTi1koL: "FAQ'S",
                                      height: "100%",
                                      id: "J6gWqCS8d",
                                      layoutId: "J6gWqCS8d",
                                      U71_cGil4:
                                        "var(--token-5afbb393-f5f6-4e8a-a267-062523956801, rgb(169, 237, 66))",
                                      variant: "jbNAB_7Xg",
                                      width: "100%",
                                      yRfDwWF7Q: "Question",
                                    }),
                                  }),
                                }),
                                e(d, {
                                  __fromCanvasComponent: !0,
                                  children: e(o, {
                                    children: e("h2", {
                                      className: "framer-styles-preset-qoet5n",
                                      "data-styles-preset": "cpwF0WKAN",
                                      children: "Preguntas Frecuentes",
                                    }),
                                  }),
                                  className: "framer-1a93087",
                                  "data-framer-name":
                                    "Let\u2019s Stay Connected",
                                  effect: $e,
                                  fonts: ["Inter"],
                                  verticalAlignment: "top",
                                  withExternalLayout: !0,
                                }),
                                e(d, {
                                  __fromCanvasComponent: !0,
                                  children: e(o, {
                                    children: e("p", {
                                      className: "framer-styles-preset-1jigmkh",
                                      "data-styles-preset": "rgOrMEYj1",
                                      children:
                                        "Te compartimos algunas de las preguntas m\xE1s comunes que tiene quienes se acercan a nuestra mutual.",
                                    }),
                                  }),
                                  className: "framer-130pmzt",
                                  "data-framer-name": "paragraph",
                                  effect: er,
                                  fonts: ["Inter"],
                                  verticalAlignment: "top",
                                  withExternalLayout: !0,
                                }),
                              ],
                            }),
                            e(fr, {
                              __framer__animate: { transition: we },
                              __framer__animateOnce: !0,
                              __framer__enter: ee,
                              __framer__exit: _e,
                              __framer__styleAppearEffectEnabled: !0,
                              __framer__threshold: 0.5,
                              __perspectiveFX: !1,
                              __targetOpacity: 1,
                              className: "framer-fsijwq",
                              "data-framer-name": "section",
                              children: r("div", {
                                className: "framer-y907uk",
                                "data-framer-name": "faq's",
                                children: [
                                  e(w, {
                                    breakpoint: c,
                                    overrides: {
                                      PV7eKQLeF: {
                                        width: `min(max(min(min(max(${i?.width || "100vw"} - 40px, 1px), 1240px), 900px) - 48px, 1px), 900px)`,
                                      },
                                      zH0fe2mqW: {
                                        width: `min(max(min(min(max(${i?.width || "100vw"} - 80px, 1px), 1240px), 900px) - 72px, 1px), 900px)`,
                                      },
                                    },
                                    children: e(n, {
                                      height: 150,
                                      width: `min(max(min(min(max(${i?.width || "100vw"} - 120px, 1px), 1240px), 900px) - 72px, 1px), 900px)`,
                                      children: e(f, {
                                        className: "framer-aaxezl-container",
                                        nodeId: "Ovfr4S__l",
                                        scopeId: "Ahpw6p2s9",
                                        children: e(ie, {
                                          EBosMvmXB:
                                            "\xBFTiene costo asociarse?",
                                          height: "100%",
                                          id: "Ovfr4S__l",
                                          layoutId: "Ovfr4S__l",
                                          rOf8huhxW:
                                            "No, ser asociado/a a Celesol no tiene ning\xFAn costo. Es un requisito obligatorio para operar, pero el proceso es gratuito, simple y se hace todo online.",
                                          style: { width: "100%" },
                                          variant: "apbhFmIL2",
                                          width: "100%",
                                        }),
                                      }),
                                    }),
                                  }),
                                  e(w, {
                                    breakpoint: c,
                                    overrides: {
                                      PV7eKQLeF: {
                                        width: `min(max(min(min(max(${i?.width || "100vw"} - 40px, 1px), 1240px), 900px) - 48px, 1px), 900px)`,
                                      },
                                      zH0fe2mqW: {
                                        width: `min(max(min(min(max(${i?.width || "100vw"} - 80px, 1px), 1240px), 900px) - 72px, 1px), 900px)`,
                                      },
                                    },
                                    children: e(n, {
                                      height: 150,
                                      width: `min(max(min(min(max(${i?.width || "100vw"} - 120px, 1px), 1240px), 900px) - 72px, 1px), 900px)`,
                                      children: e(f, {
                                        className: "framer-v3np9m-container",
                                        nodeId: "FEAg6eE7J",
                                        scopeId: "Ahpw6p2s9",
                                        children: e(ie, {
                                          EBosMvmXB:
                                            "\xBFC\xF3mo invierto en AMT?",
                                          height: "100%",
                                          id: "FEAg6eE7J",
                                          layoutId: "FEAg6eE7J",
                                          rOf8huhxW:
                                            "Para invertir en AMT, si sos una persona f\xEDsica, el proceso es sencillo: te asoci\xE1s de forma 100% gratuita y digital, transfer\xEDs el capital que quieras invertir y, al vencimiento, pod\xE9s retirar tus ganancias o renovar tu inversi\xF3n. En el caso de una mutual o entidad, primero deb\xE9s presentar la documentaci\xF3n requerida, luego se coordina una reuni\xF3n para validar la cuenta, y una vez cumplidos estos pasos, transfer\xEDs el capital y comenz\xE1s a invertir.",
                                          style: { width: "100%" },
                                          variant: "puJuZhn3f",
                                          width: "100%",
                                        }),
                                      }),
                                    }),
                                  }),
                                  e(w, {
                                    breakpoint: c,
                                    overrides: {
                                      PV7eKQLeF: {
                                        width: `min(max(min(min(max(${i?.width || "100vw"} - 40px, 1px), 1240px), 900px) - 48px, 1px), 900px)`,
                                      },
                                      zH0fe2mqW: {
                                        width: `min(max(min(min(max(${i?.width || "100vw"} - 80px, 1px), 1240px), 900px) - 72px, 1px), 900px)`,
                                      },
                                    },
                                    children: e(n, {
                                      height: 150,
                                      width: `min(max(min(min(max(${i?.width || "100vw"} - 120px, 1px), 1240px), 900px) - 72px, 1px), 900px)`,
                                      children: e(f, {
                                        className: "framer-131tvol-container",
                                        nodeId: "Dyo93UBHg",
                                        scopeId: "Ahpw6p2s9",
                                        children: e(ie, {
                                          EBosMvmXB:
                                            "\xBFQu\xE9 documentaci\xF3n necesita una mutual para invertir?",
                                          height: "100%",
                                          id: "Dyo93UBHg",
                                          layoutId: "Dyo93UBHg",
                                          rOf8huhxW: `Para que una mutual pueda realizar inversiones, debe contar con la siguiente documentaci\xF3n: el estatuto de la entidad, la constancia de inscripci\xF3n en el INAES (Instituto Nacional de Asociativismo y Econom\xEDa Social), la n\xF3mina actualizada de autoridades, la validaci\xF3n digital del presidente y de los apoderados (si corresponde), y el balance aprobado por el \xF3rgano competente. Asimismo, es fundamental que la entidad se encuentre al d\xEDa con su situaci\xF3n fiscal y legal para operar correctamente.








`,
                                          style: { width: "100%" },
                                          variant: "puJuZhn3f",
                                          width: "100%",
                                        }),
                                      }),
                                    }),
                                  }),
                                  e(w, {
                                    breakpoint: c,
                                    overrides: {
                                      PV7eKQLeF: {
                                        width: `min(max(min(min(max(${i?.width || "100vw"} - 40px, 1px), 1240px), 900px) - 48px, 1px), 900px)`,
                                      },
                                      zH0fe2mqW: {
                                        width: `min(max(min(min(max(${i?.width || "100vw"} - 80px, 1px), 1240px), 900px) - 72px, 1px), 900px)`,
                                      },
                                    },
                                    children: e(n, {
                                      height: 150,
                                      width: `min(max(min(min(max(${i?.width || "100vw"} - 120px, 1px), 1240px), 900px) - 72px, 1px), 900px)`,
                                      children: e(f, {
                                        className: "framer-ezredl-container",
                                        nodeId: "SqjLbj3on",
                                        scopeId: "Ahpw6p2s9",
                                        children: e(ie, {
                                          EBosMvmXB:
                                            "\xBFQu\xE9 plazos tiene la inversi\xF3n?",
                                          height: "100%",
                                          id: "SqjLbj3on",
                                          layoutId: "SqjLbj3on",
                                          rOf8huhxW:
                                            "Ofrecemos opciones de 30, 60 y 90 d\xEDas. Al finalizar el plazo, pod\xE9s retirar tus ganancias o reinvertirlas, seg\xFAn tu conveniencia.",
                                          style: { width: "100%" },
                                          variant: "puJuZhn3f",
                                          width: "100%",
                                        }),
                                      }),
                                    }),
                                  }),
                                  e(w, {
                                    breakpoint: c,
                                    overrides: {
                                      PV7eKQLeF: {
                                        width: `min(max(min(min(max(${i?.width || "100vw"} - 40px, 1px), 1240px), 900px) - 48px, 1px), 900px)`,
                                      },
                                      zH0fe2mqW: {
                                        width: `min(max(min(min(max(${i?.width || "100vw"} - 80px, 1px), 1240px), 900px) - 72px, 1px), 900px)`,
                                      },
                                    },
                                    children: e(n, {
                                      height: 150,
                                      width: `min(max(min(min(max(${i?.width || "100vw"} - 120px, 1px), 1240px), 900px) - 72px, 1px), 900px)`,
                                      children: e(f, {
                                        className: "framer-3dewrv-container",
                                        nodeId: "aNuxCGacy",
                                        scopeId: "Ahpw6p2s9",
                                        children: e(ie, {
                                          EBosMvmXB:
                                            "\xBFCu\xE1l es la rentabilidad?",
                                          height: "100%",
                                          id: "aNuxCGacy",
                                          layoutId: "aNuxCGacy",
                                          rOf8huhxW:
                                            "La tasa var\xEDa seg\xFAn el monto, el plazo y el contexto econ\xF3mico. Por eso, ofrecemos asesoramiento personalizado para ayudarte a elegir la mejor alternativa.",
                                          style: { width: "100%" },
                                          variant: "puJuZhn3f",
                                          width: "100%",
                                        }),
                                      }),
                                    }),
                                  }),
                                ],
                              }),
                            }),
                          ],
                        }),
                        r("div", {
                          className: "framer-1tp5f8t",
                          "data-framer-name": "bg gradient",
                          children: [
                            e("div", {
                              className: "framer-1dqs27v",
                              "data-framer-name": "color",
                            }),
                            e("div", {
                              className: "framer-dw5w72",
                              "data-framer-name": "color",
                            }),
                            e("div", {
                              className: "framer-1pe2hzf",
                              "data-framer-name": "color",
                            }),
                          ],
                        }),
                        h() &&
                          e(t.div, {
                            className: "framer-qvfhcg hidden-1a3i2to",
                            "data-framer-name": "scribble",
                            style: { rotate: 209 },
                            children: e(C, {
                              className: "framer-1uc0w4t",
                              "data-framer-name": "Swirls",
                              opacity: 0.33,
                              svg: '<svg xmlns="/2000/svg" xmlns:xlink="/1999/xlink" viewBox="0 0 138 71"><path d="M 15.093 2.504 C 10.111 2.504 4.866 9.409 3.622 13.936 C 1.583 21.353 1.865 29.763 2.396 37.387 C 2.942 45.217 6.058 54.867 13.23 59.128 C 18.864 62.475 28.643 63.551 35.045 62.108 C 41.261 60.707 47.98 55.498 50.291 49.601 C 51.883 45.539 51.976 39.376 49.164 35.872 C 47.14 33.351 41.362 32.762 39.016 34.945 C 35.541 38.176 32.578 42.487 31.957 47.305 C 30.98 54.879 32.343 59.722 38.967 64.013 C 47.526 69.558 61.108 69.867 70.243 66.114 C 80.467 61.914 91.319 53.518 96.323 43.543 C 98.614 38.978 99.752 34.057 100.147 28.984 C 100.374 26.069 100.846 22.283 99.167 19.701 C 96.42 15.477 90.348 14.566 86.568 18.333 C 83.062 21.827 82.577 27.862 83.92 32.452 C 84.987 36.097 89.378 38.98 92.5 40.758 C 96.527 43.051 101.977 43.426 106.52 43.396 C 119.669 43.309 129.028 30.234 135.982 20.532" fill="transparent" stroke-width="3.11" stroke="var(--token-5afbb393-f5f6-4e8a-a267-062523956801, rgb(169, 237, 66))" stroke-linecap="round" stroke-miterlimit="10"></path></svg>',
                              svgContentId: 9742693615,
                              withExternalLayout: !0,
                            }),
                          }),
                      ],
                    }),
                    e(n, {
                      height: 322,
                      width: i?.width || "100vw",
                      children: e(f, {
                        className: "framer-2f4cpt-container",
                        id: tr,
                        nodeId: "otFsjtIkD",
                        ref: ar,
                        scopeId: "Ahpw6p2s9",
                        children: e(w, {
                          breakpoint: c,
                          overrides: {
                            PV7eKQLeF: { variant: "OEij7UgX_" },
                            zH0fe2mqW: { variant: "bVk6oWAF3" },
                          },
                          children: e(or, {
                            height: "100%",
                            id: "otFsjtIkD",
                            layoutId: "otFsjtIkD",
                            style: { width: "100%" },
                            variant: "Nv1WrDwPR",
                            width: "100%",
                          }),
                        }),
                      }),
                    }),
                  ],
                }),
                e(n, {
                  children: e(f, {
                    className: "framer-12mxlii-container",
                    isAuthoredByUser: !0,
                    isModuleExternal: !0,
                    nodeId: "JEQo3xhdt",
                    scopeId: "Ahpw6p2s9",
                    children: e(nr, {
                      height: "100%",
                      id: "JEQo3xhdt",
                      intensity: 15,
                      layoutId: "JEQo3xhdt",
                      width: "100%",
                    }),
                  }),
                }),
              ],
            }),
            e("div", { id: "overlay" }),
          ],
        }),
      })
    );
  }),
  Pa = [
    "@supports (aspect-ratio: 1) { body { --framer-aspect-ratio-supported: auto; } }",
    ".framer-71fo5.framer-1pu0e0a, .framer-71fo5 .framer-1pu0e0a { display: block; }",
    ".framer-71fo5.framer-1e3fpg9 { align-content: center; align-items: center; background-color: var(--token-d49ce14e-f5dc-463a-9b8d-4f0e772df7f1, #ffffff); display: flex; flex-direction: column; flex-wrap: nowrap; gap: 0px; height: min-content; justify-content: flex-start; overflow: hidden; padding: 0px; position: relative; width: 1200px; }",
    ".framer-71fo5 .framer-1iaakrr-container { flex: none; height: auto; left: 50%; max-width: 1100px; position: fixed; top: 20px; transform: translateX(-50%); width: 90%; z-index: 7; }",
    ".framer-71fo5 .framer-7neocn { align-content: center; align-items: center; display: flex; flex: none; flex-direction: column; flex-wrap: nowrap; gap: 32px; height: min-content; justify-content: center; overflow: hidden; padding: 160px 60px 96px 60px; position: relative; width: 100%; z-index: 1; }",
    ".framer-71fo5 .framer-tixfw1 { align-content: center; align-items: center; display: flex; flex: none; flex-direction: column; flex-wrap: nowrap; gap: 44px; height: min-content; justify-content: flex-start; max-width: 1240px; overflow: visible; padding: 0px; position: relative; width: 100%; z-index: 3; }",
    ".framer-71fo5 .framer-1buhn8w { -webkit-filter: hue-rotate(61deg); aspect-ratio: 1.0791083916083917 / 1; bottom: -12px; cursor: grab; filter: hue-rotate(61deg); flex: none; height: var(--framer-aspect-ratio-supported, 233px); left: -26px; overflow: visible; position: absolute; width: 251px; will-change: var(--framer-will-change-effect-override, transform); z-index: 5; }",
    ".framer-71fo5 .framer-8r41lt { -webkit-filter: hue-rotate(61deg); aspect-ratio: 1.2662771285475793 / 1; cursor: grab; filter: hue-rotate(61deg); flex: none; height: var(--framer-aspect-ratio-supported, 198px); overflow: visible; position: absolute; right: -34px; top: 112px; width: 251px; will-change: var(--framer-will-change-effect-override, transform); z-index: 5; }",
    ".framer-71fo5 .framer-rxuu3z { align-content: center; align-items: center; display: flex; flex: none; flex-direction: column; flex-wrap: nowrap; gap: 24px; height: min-content; justify-content: flex-start; overflow: visible; padding: 0px; position: relative; width: 100%; z-index: 3; }",
    ".framer-71fo5 .framer-ry1g1k { align-content: center; align-items: center; background-color: var(--token-5afbb393-f5f6-4e8a-a267-062523956801, #64b09f); border-bottom-left-radius: 18px; border-bottom-right-radius: 18px; border-top-left-radius: 18px; border-top-right-radius: 18px; display: flex; flex: none; flex-direction: column; flex-wrap: nowrap; gap: 6px; height: min-content; justify-content: center; max-width: 260px; overflow: hidden; padding: 6px 20px 6px 20px; position: relative; width: 100%; will-change: var(--framer-will-change-effect-override, transform); }",
    ".framer-71fo5 .framer-1euozh6 { --framer-paragraph-spacing: 0px; flex: none; height: auto; position: relative; white-space: pre-wrap; width: 100%; word-break: break-word; word-wrap: break-word; }",
    ".framer-71fo5 .framer-utdqrh { align-content: center; align-items: center; display: flex; flex: none; flex-direction: column; flex-wrap: nowrap; gap: 16px; height: min-content; justify-content: center; overflow: visible; padding: 0px; position: relative; width: 100%; }",
    ".framer-71fo5 .framer-1f3pz81 { --framer-paragraph-spacing: 0px; flex: none; height: auto; max-width: 880px; position: relative; white-space: pre-wrap; width: 100%; word-break: break-word; word-wrap: break-word; z-index: 2; }",
    ".framer-71fo5 .framer-i5ukzz, .framer-71fo5 .framer-1ctw3kr, .framer-71fo5 .framer-130pmzt { --framer-paragraph-spacing: 0px; flex: none; height: auto; max-width: 640px; position: relative; white-space: pre-wrap; width: 100%; word-break: break-word; word-wrap: break-word; }",
    ".framer-71fo5 .framer-1i8f6p2 { align-content: center; align-items: center; display: flex; flex: none; flex-direction: row; flex-wrap: wrap; gap: 16px; height: min-content; justify-content: center; overflow: visible; padding: 0px; position: relative; width: 100%; z-index: 3; }",
    ".framer-71fo5 .framer-r1sdbk-container, .framer-71fo5 .framer-18dm7lu-container { flex: none; height: auto; position: relative; width: auto; will-change: var(--framer-will-change-effect-override, transform); z-index: 3; }",
    ".framer-71fo5 .framer-1v0qwjl { align-content: center; align-items: center; display: flex; flex: none; flex-direction: column; flex-wrap: nowrap; gap: 8px; height: min-content; justify-content: center; max-width: 640px; overflow: hidden; padding: 0px; position: relative; width: 100%; }",
    ".framer-71fo5 .framer-174svav { --framer-paragraph-spacing: 0px; flex: none; height: auto; opacity: 0.6; position: relative; white-space: pre-wrap; width: 100%; will-change: var(--framer-will-change-effect-override, transform); word-break: break-word; word-wrap: break-word; }",
    ".framer-71fo5 .framer-1ac88zf { bottom: -260px; flex: none; left: -703px; opacity: 0.1; overflow: visible; position: absolute; top: -248px; width: 838px; z-index: 1; }",
    ".framer-71fo5 .framer-6u973x, .framer-71fo5 .framer-sur2ud { flex: none; height: 1230px; left: calc(47.02797202797205% - 612.8688220999616px / 2); position: absolute; top: calc(47.21104082806213% - 1230.127716646226px / 2); width: 613px; }",
    ".framer-71fo5 .framer-c39bn5, .framer-71fo5 .framer-8a6vp7 { flex: none; height: 1230px; left: calc(48.251748251748275% - 612.8688220999616px / 2); position: absolute; top: calc(50.37377803335252% - 1230.127716646226px / 2); width: 613px; }",
    ".framer-71fo5 .framer-w98ms7, .framer-71fo5 .framer-aip0aq { flex: none; height: 1230px; left: calc(52.88461538461541% - 612.8688220999616px / 2); position: absolute; top: calc(52.73145485911446% - 1230.127716646226px / 2); width: 613px; }",
    ".framer-71fo5 .framer-vn16h0 { bottom: -612px; flex: none; opacity: 0.1; overflow: hidden; position: absolute; right: -964px; top: -573px; width: 1436px; z-index: 1; }",
    ".framer-71fo5 .framer-1mw8a1g { align-content: center; align-items: center; background-color: var(--token-5afbb393-f5f6-4e8a-a267-062523956801, #64b09f); border-bottom-left-radius: 36px; border-bottom-right-radius: 36px; border-top-left-radius: 36px; border-top-right-radius: 36px; display: flex; flex: none; flex-direction: row; flex-wrap: nowrap; gap: 5px; height: min-content; justify-content: center; overflow: hidden; padding: 5px; position: relative; text-decoration: none; width: min-content; will-change: var(--framer-will-change-effect-override, transform); z-index: 5; }",
    ".framer-71fo5 .framer-1j7iv35-container { flex: none; height: 25px; opacity: 0.4; position: relative; width: 25px; }",
    ".framer-71fo5 .framer-1i6f5hz { border-bottom-left-radius: 16px; border-bottom-right-radius: 16px; border-top-left-radius: 16px; border-top-right-radius: 16px; bottom: 0px; flex: none; left: 0px; opacity: 0.7; overflow: visible; position: absolute; right: 0px; top: 0px; z-index: 1; }",
    ".framer-71fo5 .framer-1wc2c8w, .framer-71fo5 .framer-of0s7s, .framer-71fo5 .framer-1rrjsx4, .framer-71fo5 .framer-1dqs27v { background: radial-gradient(50% 50% at 50% 50%, var(--token-d626c3c3-2d1d-43fc-a261-41c3249f6a7c, #eaf0dd) 0%, rgba(171, 171, 171, 0) 100%); flex: none; height: 627px; left: calc(36.50000000000002% - 717px / 2); overflow: hidden; position: absolute; top: calc(52.94759825327513% - 627px / 2); width: 717px; }",
    ".framer-71fo5 .framer-13zna6p, .framer-71fo5 .framer-86lf4, .framer-71fo5 .framer-1n7i801, .framer-71fo5 .framer-dw5w72 { background: radial-gradient(50% 50% at 50% 50%, var(--token-94539f16-8480-49c8-9a5c-337b3e6187f6, #f4ffeb) 0%, rgba(255, 255, 255, 0) 100%); flex: none; height: 619px; left: calc(50.00000000000002% - 774px / 2); overflow: hidden; position: absolute; top: calc(50.00000000000002% - 619px / 2); width: 774px; }",
    ".framer-71fo5 .framer-1s8ovu3 { background: radial-gradient(50% 50% at 50% 50%, rgba(100, 176, 160, 0.5) 0%, rgba(255, 255, 255, 0) 100%); flex: none; height: 487px; left: calc(70.66666666666669% - 713px / 2); overflow: hidden; position: absolute; top: calc(53.38427947598255% - 487px / 2); width: 713px; }",
    ".framer-71fo5 .framer-1yzuk16 { --border-bottom-width: 1px; --border-color: var(--token-d626c3c3-2d1d-43fc-a261-41c3249f6a7c, #eaf0dd); --border-left-width: 0px; --border-right-width: 0px; --border-style: solid; --border-top-width: 1px; align-content: center; align-items: center; background: linear-gradient(139deg, var(--token-ba45ae08-0354-45a4-88d7-90a247ed9082, #fff2d1) 31%, rgb(74, 130, 122) 40%, rgb(54, 94, 95) 49%, rgb(38, 65, 76) 62%, rgb(29, 48, 67) 72%, rgb(29, 48, 67) 81%, rgb(23, 36, 61) 89%); display: flex; flex: none; flex-direction: column; flex-wrap: nowrap; gap: 80px; height: min-content; justify-content: flex-start; overflow: visible; padding: 96px 60px 96px 60px; position: relative; scroll-margin-top: 60px; width: 100%; }",
    ".framer-71fo5 .framer-1ilo44i { align-content: flex-start; align-items: flex-start; display: flex; flex: none; flex-direction: column; flex-wrap: nowrap; gap: 44px; height: min-content; justify-content: center; max-width: 1240px; overflow: visible; padding: 0px; position: relative; width: 100%; z-index: 2; }",
    ".framer-71fo5 .framer-1ykcc7x { align-content: flex-start; align-items: flex-start; display: flex; flex: none; flex-direction: column; flex-wrap: nowrap; gap: 16px; height: min-content; justify-content: flex-start; overflow: visible; padding: 0px; position: relative; width: 100%; }",
    ".framer-71fo5 .framer-1256tvp-container, .framer-71fo5 .framer-wjiinw-container, .framer-71fo5 .framer-13z1yt4-container, .framer-71fo5 .framer-1g4rlu5-container, .framer-71fo5 .framer-12mxlii-container { flex: none; height: auto; position: relative; width: auto; }",
    ".framer-71fo5 .framer-8dec7i { flex: none; height: auto; max-width: 720px; position: relative; white-space: pre-wrap; width: 100%; word-break: break-word; word-wrap: break-word; }",
    ".framer-71fo5 .framer-1lstr9w { flex: none; height: auto; max-width: 640px; position: relative; white-space: pre-wrap; width: 100%; word-break: break-word; word-wrap: break-word; }",
    ".framer-71fo5 .framer-5am9pe { align-content: center; align-items: center; display: flex; flex: none; flex-direction: column; flex-wrap: nowrap; gap: 54px; height: min-content; justify-content: flex-start; overflow: visible; padding: 0px; position: relative; width: 100%; }",
    ".framer-71fo5 .framer-1xviqca { --border-bottom-width: 1px; --border-color: var(--token-d626c3c3-2d1d-43fc-a261-41c3249f6a7c, rgba(234, 239, 221, 0.49)); --border-left-width: 1px; --border-right-width: 1px; --border-style: solid; --border-top-width: 1px; align-content: flex-start; align-items: flex-start; background-color: var(--token-0d217399-5502-4e36-ad35-aff6664c8307, #ffffff); border-bottom-left-radius: 15px; border-bottom-right-radius: 15px; border-top-left-radius: 15px; border-top-right-radius: 15px; display: flex; flex: none; flex-direction: column; flex-wrap: nowrap; gap: 30px; height: min-content; justify-content: center; overflow: hidden; padding: 36px; position: relative; width: 100%; will-change: var(--framer-will-change-override, transform); }",
    ".framer-71fo5 .framer-1mbn5f4 { align-content: flex-start; align-items: flex-start; display: flex; flex: none; flex-direction: row; flex-wrap: nowrap; gap: 24px; height: min-content; justify-content: center; overflow: visible; padding: 0px; position: relative; width: 100%; }",
    ".framer-71fo5 .framer-1038vt7, .framer-71fo5 .framer-paim16, .framer-71fo5 .framer-1a4fov4 { align-content: flex-start; align-items: flex-start; display: flex; flex: 1 0 0px; flex-direction: column; flex-wrap: nowrap; gap: 24px; height: min-content; justify-content: flex-start; overflow: visible; padding: 0px; position: relative; width: 1px; }",
    ".framer-71fo5 .framer-zrgqed, .framer-71fo5 .framer-xc1kba, .framer-71fo5 .framer-mqd7tl { align-content: center; align-items: center; aspect-ratio: 1 / 1; background-color: var(--token-162cc6f1-5b31-4c9d-a955-3d5570248c76, #1d1f13); border-bottom-left-radius: 53px; border-bottom-right-radius: 53px; border-top-left-radius: 53px; border-top-right-radius: 53px; display: flex; flex: none; flex-direction: row; flex-wrap: nowrap; gap: 4px; height: var(--framer-aspect-ratio-supported, 53px); justify-content: center; overflow: visible; padding: 8px; position: relative; width: 53px; z-index: 2; }",
    ".framer-71fo5 .framer-kutybd-container, .framer-71fo5 .framer-1kbjpvd-container, .framer-71fo5 .framer-sbca8o-container { aspect-ratio: 1 / 1; flex: none; height: var(--framer-aspect-ratio-supported, 34px); position: relative; width: 31px; }",
    ".framer-71fo5 .framer-umjzo1, .framer-71fo5 .framer-ovgtru, .framer-71fo5 .framer-y6p2q1 { align-content: flex-start; align-items: flex-start; display: flex; flex: none; flex-direction: column; flex-wrap: nowrap; gap: 16px; height: min-content; justify-content: center; overflow: hidden; padding: 0px; position: relative; width: 100%; }",
    ".framer-71fo5 .framer-1sllrqb, .framer-71fo5 .framer-jzu12z, .framer-71fo5 .framer-1ld0whk { --framer-link-text-color: #0099ff; --framer-link-text-decoration: underline; flex: none; height: auto; max-width: 240px; position: relative; white-space: pre-wrap; width: 100%; word-break: break-word; word-wrap: break-word; }",
    ".framer-71fo5 .framer-1uf1ml, .framer-71fo5 .framer-17q4pyd, .framer-71fo5 .framer-1amof5o { flex: none; height: auto; position: relative; white-space: pre-wrap; width: 100%; word-break: break-word; word-wrap: break-word; }",
    ".framer-71fo5 .framer-7zw2gx, .framer-71fo5 .framer-yar60u { align-self: stretch; background-color: var(--token-d626c3c3-2d1d-43fc-a261-41c3249f6a7c, #eaf0dd); flex: none; height: auto; overflow: hidden; position: relative; width: 1px; }",
    ".framer-71fo5 .framer-stql3x { flex: none; height: 71px; overflow: hidden; position: absolute; right: 0px; top: -99px; width: 138px; z-index: 1; }",
    ".framer-71fo5 .framer-hqd059, .framer-71fo5 .framer-em36xr { flex: none; height: 71px; left: calc(50.00000000000002% - 138px / 2); opacity: 0.33; position: absolute; top: -10px; width: 138px; }",
    ".framer-71fo5 .framer-pc9dse { flex: none; height: 71px; left: calc(-5.555555555555533% - 138px / 2); overflow: hidden; position: absolute; top: calc(112.15805471124622% - 71px / 2); width: 138px; z-index: 1; }",
    ".framer-71fo5 .framer-1c1q6ku, .framer-71fo5 .framer-3nmjld { flex: none; height: 71px; left: calc(50.00000000000002% - 138px / 2); opacity: 0.33; position: absolute; top: calc(49.29577464788735% - 71px / 2); width: 138px; }",
    ".framer-71fo5 .framer-yaeckb, .framer-71fo5 .framer-1fzk25t { align-content: center; align-items: center; display: flex; flex: none; flex-direction: column; flex-wrap: nowrap; gap: 0px; height: min-content; justify-content: center; overflow: hidden; padding: 0px; position: relative; width: 100%; }",
    ".framer-71fo5 .framer-9884ud-container, .framer-71fo5 .framer-eobjje-container { flex: none; height: 80px; max-width: 1280px; position: relative; width: 100%; }",
    ".framer-71fo5 .framer-1g7fu6a-container, .framer-71fo5 .framer-f1nrub-container, .framer-71fo5 .framer-1g9d8jx-container, .framer-71fo5 .framer-1ln14kl-container, .framer-71fo5 .framer-1dvdi2x-container, .framer-71fo5 .framer-1jjvva4-container, .framer-71fo5 .framer-ig32h7-container { height: auto; position: relative; width: auto; }",
    ".framer-71fo5 .framer-1l6n183-container, .framer-71fo5 .framer-aaxezl-container, .framer-71fo5 .framer-v3np9m-container, .framer-71fo5 .framer-131tvol-container, .framer-71fo5 .framer-ezredl-container, .framer-71fo5 .framer-3dewrv-container, .framer-71fo5 .framer-2f4cpt-container { flex: none; height: auto; position: relative; width: 100%; }",
    ".framer-71fo5 .framer-3q637b { --border-bottom-width: 1px; --border-color: var(--token-d626c3c3-2d1d-43fc-a261-41c3249f6a7c, #eaf0dd); --border-left-width: 0px; --border-right-width: 0px; --border-style: solid; --border-top-width: 1px; align-content: center; align-items: center; background: linear-gradient(230deg, var(--token-ba45ae08-0354-45a4-88d7-90a247ed9082, #fff2d1) 11%, rgb(66, 116, 112) 46%, rgb(50, 87, 91) 57.99999999999999%, rgb(51, 89, 93) 64%, var(--token-162cc6f1-5b31-4c9d-a955-3d5570248c76, rgb(23, 36, 61)) 68%, rgb(24, 38, 62) 70%); display: flex; flex: none; flex-direction: row; flex-wrap: nowrap; gap: 10px; height: min-content; justify-content: center; overflow: visible; padding: 96px 60px 96px 60px; position: relative; scroll-margin-top: 40px; width: 100%; z-index: 1; }",
    ".framer-71fo5 .framer-yq1sjd, .framer-71fo5 .framer-qi28bb, .framer-71fo5 .framer-bc593k { align-content: center; align-items: center; display: flex; flex: 1 0 0px; flex-direction: column; flex-wrap: nowrap; gap: 44px; height: min-content; justify-content: center; max-width: 1240px; overflow: visible; padding: 0px; position: relative; width: 1px; z-index: 2; }",
    ".framer-71fo5 .framer-y2gxbc, .framer-71fo5 .framer-idbir2, .framer-71fo5 .framer-877ltl { align-content: center; align-items: center; display: flex; flex: none; flex-direction: column; flex-wrap: nowrap; gap: 16px; height: min-content; justify-content: center; overflow: hidden; padding: 0px; position: relative; width: 100%; }",
    ".framer-71fo5 .framer-drkz2c { --framer-link-text-color: #0099ff; --framer-link-text-decoration: underline; flex: none; height: auto; max-width: 720px; position: relative; white-space: pre-wrap; width: 100%; word-break: break-word; word-wrap: break-word; }",
    ".framer-71fo5 .framer-4lobi { --framer-link-text-color: #0099ff; --framer-link-text-decoration: underline; flex: none; height: auto; max-width: 650px; position: relative; white-space: pre-wrap; width: 100%; word-break: break-word; word-wrap: break-word; }",
    ".framer-71fo5 .framer-1xt1wio, .framer-71fo5 .framer-jei5en { align-content: flex-start; align-items: flex-start; display: flex; flex: none; flex-direction: row; flex-wrap: wrap; gap: 32px; height: min-content; justify-content: center; overflow: visible; padding: 0px; position: relative; width: 100%; }",
    ".framer-71fo5 .framer-pu5m8w-container, .framer-71fo5 .framer-29p146-container { flex: 1 0 0px; height: auto; position: relative; width: 1px; z-index: 1; }",
    ".framer-71fo5 .framer-htgykz { flex: none; height: 71px; left: 844px; overflow: hidden; position: absolute; top: -274px; width: 138px; z-index: 1; }",
    ".framer-71fo5 .framer-1kgo11a { align-content: center; align-items: center; display: flex; flex: none; flex-direction: column; flex-wrap: nowrap; gap: 32px; height: min-content; justify-content: center; overflow: visible; padding: 0px; position: relative; width: 100%; }",
    ".framer-71fo5 .framer-11ity0d { align-content: center; align-items: center; background-color: var(--token-94539f16-8480-49c8-9a5c-337b3e6187f6, #f7f8f5); display: flex; flex: none; flex-direction: row; flex-wrap: nowrap; gap: 40px; height: min-content; justify-content: center; overflow: hidden; padding: 8px; position: relative; width: 100%; }",
    ".framer-71fo5 .framer-1pcq7ay, .framer-71fo5 .framer-1jj1a9s, .framer-71fo5 .framer-1h36qo7 { align-content: center; align-items: center; display: flex; flex: none; flex-direction: row; flex-wrap: nowrap; gap: 10px; height: min-content; justify-content: center; overflow: hidden; padding: 0px; position: relative; width: min-content; }",
    ".framer-71fo5 .framer-1d4hqw2-container, .framer-71fo5 .framer-1ahidaj-container { flex: none; height: 32px; position: relative; width: 32px; }",
    ".framer-71fo5 .framer-t4o3go, .framer-71fo5 .framer-1bbxlc2, .framer-71fo5 .framer-9abrok { --framer-link-text-color: #0099ff; --framer-link-text-decoration: underline; flex: none; height: auto; position: relative; white-space: pre; width: auto; }",
    ".framer-71fo5 .framer-2nkzf2-container { flex: none; height: 31px; position: relative; width: 31px; }",
    ".framer-71fo5 .framer-1s18s58 { align-content: center; align-items: center; display: flex; flex: none; flex-direction: column; flex-wrap: wrap; gap: 16px; height: min-content; justify-content: center; overflow: visible; padding: 0px; position: relative; width: 100%; }",
    ".framer-71fo5 .framer-1llt0cq { align-content: center; align-items: center; background-color: var(--token-94539f16-8480-49c8-9a5c-337b3e6187f6, #f7f8f5); border-bottom-left-radius: 16px; border-bottom-right-radius: 16px; border-top-left-radius: 16px; border-top-right-radius: 16px; box-shadow: 0px -22px 37px 0px var(--token-330dd38f-b9f3-4029-8b3f-ea4ad498014a, rgba(29, 31, 19, 0.05)); display: flex; flex: none; flex-direction: column; flex-wrap: nowrap; gap: 16px; height: min-content; justify-content: center; max-width: 640px; overflow: hidden; padding: 30px; position: relative; width: 100%; will-change: var(--framer-will-change-override, transform); }",
    ".framer-71fo5 .framer-1b27k81, .framer-71fo5 .framer-xap9ij { --framer-link-text-color: #0099ff; --framer-link-text-decoration: underline; flex: none; height: auto; position: relative; white-space: pre-wrap; width: 100%; word-break: break-word; word-wrap: break-word; }",
    ".framer-71fo5 .framer-10xysex-container { flex: none; height: auto; position: relative; width: auto; z-index: 3; }",
    ".framer-71fo5 .framer-1rnyb30 { flex: none; height: 71px; left: calc(11.851851851851874% - 138px / 2); overflow: hidden; position: absolute; top: calc(2.512562814070374% - 71px / 2); width: 138px; z-index: 1; }",
    ".framer-71fo5 .framer-8slvbf, .framer-71fo5 .framer-msnne0, .framer-71fo5 .framer-1tp5f8t { border-bottom-left-radius: 16px; border-bottom-right-radius: 16px; border-top-left-radius: 16px; border-top-right-radius: 16px; bottom: 0px; flex: none; left: 0px; overflow: visible; position: absolute; right: 0px; top: 0px; z-index: 1; }",
    ".framer-71fo5 .framer-i89ici, .framer-71fo5 .framer-6o41zt, .framer-71fo5 .framer-1pe2hzf { background: radial-gradient(50% 50% at 50% 50%, var(--token-ba45ae08-0354-45a4-88d7-90a247ed9082, #f0ffd1) 0%, rgba(255, 255, 255, 0) 100%); flex: none; height: 487px; left: calc(70.66666666666669% - 713px / 2); overflow: hidden; position: absolute; top: calc(53.38427947598255% - 487px / 2); width: 713px; }",
    ".framer-71fo5 .framer-18x17iz { align-content: center; align-items: center; background: linear-gradient(133deg, var(--token-ba45ae08-0354-45a4-88d7-90a247ed9082, #fff2d1) -13.075846201039035%, var(--token-d49ce14e-f5dc-463a-9b8d-4f0e772df7f1, rgb(255, 255, 255)) 55.00000000000001%); display: flex; flex: none; flex-direction: row; flex-wrap: nowrap; gap: 10px; height: min-content; justify-content: center; overflow: hidden; padding: 96px 60px 96px 60px; position: relative; width: 100%; }",
    ".framer-71fo5 .framer-1v9n0cq, .framer-71fo5 .framer-1a93087 { --framer-paragraph-spacing: 0px; flex: none; height: auto; max-width: 720px; position: relative; white-space: pre-wrap; width: 100%; word-break: break-word; word-wrap: break-word; }",
    ".framer-71fo5 .framer-1wdidps, .framer-71fo5 .framer-mn4tq1, .framer-71fo5 .framer-15uy15h { align-content: center; align-items: center; display: flex; flex: 1 0 0px; flex-direction: column; flex-wrap: nowrap; gap: 32px; height: min-content; justify-content: center; max-width: 440px; overflow: visible; padding: 0px; position: relative; width: 1px; }",
    ".framer-71fo5 .framer-1mybq54-container, .framer-71fo5 .framer-ctcugq-container, .framer-71fo5 .framer-ap7khv-container { flex: none; height: auto; position: relative; width: 100%; z-index: 2; }",
    ".framer-71fo5 .framer-1q8114m { flex: none; height: 70px; left: calc(78.41666666666669% - 138px / 2); overflow: hidden; position: absolute; top: calc(6.603081438004424% - 70px / 2); width: 138px; z-index: 2; }",
    ".framer-71fo5 .framer-gt3ckj, .framer-71fo5 .framer-1uc0w4t { flex: none; height: 71px; left: calc(50.00000000000002% - 138px / 2); opacity: 0.33; position: absolute; top: calc(48.57142857142859% - 71px / 2); width: 138px; }",
    ".framer-71fo5 .framer-1ajochk { --border-bottom-width: 1px; --border-color: var(--token-d626c3c3-2d1d-43fc-a261-41c3249f6a7c, #eaf0dd); --border-left-width: 0px; --border-right-width: 0px; --border-style: solid; --border-top-width: 1px; align-content: center; align-items: center; background: linear-gradient(133deg, var(--token-ba45ae08-0354-45a4-88d7-90a247ed9082, #fff2d1) -13.075846201039035%, var(--token-d49ce14e-f5dc-463a-9b8d-4f0e772df7f1, rgb(255, 255, 255)) 55.00000000000001%); display: flex; flex: none; flex-direction: row; flex-wrap: nowrap; gap: 10px; height: min-content; justify-content: center; overflow: hidden; padding: 96px 60px 96px 60px; position: relative; width: 100%; }",
    ".framer-71fo5 .framer-fsijwq { align-content: center; align-items: center; background: radial-gradient(50% 50% at 50% 50%, var(--token-2392f422-058e-43d6-a305-98e43baba6b1, rgba(255, 255, 255, 0.4)) 0%, var(--token-d49ce14e-f5dc-463a-9b8d-4f0e772df7f1, rgb(255, 255, 255)) 100%); border-bottom-left-radius: 16px; border-bottom-right-radius: 16px; border-top-left-radius: 16px; border-top-right-radius: 16px; box-shadow: 0px -22px 37px 0px var(--token-330dd38f-b9f3-4029-8b3f-ea4ad498014a, rgba(29, 31, 19, 0.05)); display: flex; flex: none; flex-direction: row; flex-wrap: nowrap; gap: 10px; height: min-content; justify-content: center; max-width: 900px; overflow: visible; padding: 36px; position: relative; width: 100%; }",
    ".framer-71fo5 .framer-y907uk { align-content: center; align-items: center; display: flex; flex: 1 0 0px; flex-direction: column; flex-wrap: nowrap; gap: 16px; height: min-content; justify-content: center; max-width: 900px; overflow: visible; padding: 0px; position: relative; width: 1px; }",
    ".framer-71fo5 .framer-qvfhcg { flex: none; height: 70px; left: calc(73.16666666666669% - 138px / 2); overflow: hidden; position: absolute; top: calc(28.472906403940907% - 70px / 2); width: 138px; z-index: 2; }",
    ...qe,
    ...Rr,
    ...He,
    ...xe,
    ...We,
    ...Ur,
    ...Ee,
    ...Be,
    '.framer-71fo5[data-border="true"]::after, .framer-71fo5 [data-border="true"]::after { content: ""; border-width: var(--border-top-width, 0) var(--border-right-width, 0) var(--border-bottom-width, 0) var(--border-left-width, 0); border-color: var(--border-color, none); border-style: var(--border-style, none); width: 100%; height: 100%; position: absolute; box-sizing: border-box; left: 0; top: 0; border-radius: inherit; pointer-events: none; }',
    "@media (min-width: 810px) and (max-width: 1199px) { .framer-71fo5.framer-1e3fpg9 { width: 810px; } .framer-71fo5 .framer-1iaakrr-container { left: 50%; max-width: unset; order: 0; } .framer-71fo5 .framer-7neocn { order: 1; padding: 120px 40px 80px 40px; } .framer-71fo5 .framer-1buhn8w { bottom: -80px; height: var(--framer-aspect-ratio-supported, 195px); left: -40px; width: 210px; } .framer-71fo5 .framer-8r41lt { height: var(--framer-aspect-ratio-supported, 166px); right: -134px; width: 210px; } .framer-71fo5 .framer-1yzuk16 { order: 2; padding: 80px 40px 80px 40px; } .framer-71fo5 .framer-1ilo44i, .framer-71fo5 .framer-1ykcc7x { align-content: center; align-items: center; } .framer-71fo5 .framer-1mbn5f4, .framer-71fo5 .framer-1xt1wio { flex-direction: column; } .framer-71fo5 .framer-1038vt7, .framer-71fo5 .framer-paim16, .framer-71fo5 .framer-1a4fov4, .framer-71fo5 .framer-pu5m8w-container, .framer-71fo5 .framer-29p146-container { flex: none; width: 100%; } .framer-71fo5 .framer-1sllrqb, .framer-71fo5 .framer-jzu12z, .framer-71fo5 .framer-1ld0whk, .framer-71fo5 .framer-1wdidps, .framer-71fo5 .framer-mn4tq1, .framer-71fo5 .framer-15uy15h { max-width: unset; } .framer-71fo5 .framer-7zw2gx, .framer-71fo5 .framer-yar60u { align-self: unset; height: 2px; width: 100%; } .framer-71fo5 .framer-1kbjpvd-container { aspect-ratio: unset; height: 31px; } .framer-71fo5 .framer-pc9dse { bottom: -27px; left: 0px; top: unset; } .framer-71fo5 .framer-1l6n183-container { order: 4; } .framer-71fo5 .framer-3q637b { order: 5; padding: 80px 40px 80px 40px; } .framer-71fo5 .framer-4lobi { max-width: 621px; } .framer-71fo5 .framer-htgykz { left: 0px; top: -241px; } .framer-71fo5 .framer-18x17iz { order: 6; padding: 80px 40px 80px 40px; } .framer-71fo5 .framer-1q8114m, .framer-71fo5 .framer-qvfhcg { height: 69px; left: calc(90.00000000000003% - 138px / 2); top: calc(12.713797035347799% - 69px / 2); } .framer-71fo5 .framer-1fzk25t { order: 7; } .framer-71fo5 .framer-1ajochk { padding: 80px 40px 80px 40px; } .framer-71fo5 .framer-12mxlii-container { order: 8; }}",
    "@media (max-width: 809px) { .framer-71fo5.framer-1e3fpg9 { width: 390px; } .framer-71fo5 .framer-1iaakrr-container { left: 50%; max-width: unset; } .framer-71fo5 .framer-7neocn { gap: 80px; padding: 120px 20px 80px 20px; } .framer-71fo5 .framer-1buhn8w { bottom: -80px; height: var(--framer-aspect-ratio-supported, 145px); left: -36px; width: 156px; } .framer-71fo5 .framer-8r41lt { height: var(--framer-aspect-ratio-supported, 123px); right: -101px; top: 360px; width: 156px; } .framer-71fo5 .framer-1yzuk16, .framer-71fo5 .framer-3q637b, .framer-71fo5 .framer-18x17iz, .framer-71fo5 .framer-1ajochk { padding: 80px 20px 80px 20px; } .framer-71fo5 .framer-1ykcc7x { align-content: center; align-items: center; } .framer-71fo5 .framer-1mbn5f4 { flex-direction: column; justify-content: flex-start; } .framer-71fo5 .framer-1038vt7, .framer-71fo5 .framer-paim16, .framer-71fo5 .framer-1a4fov4, .framer-71fo5 .framer-pu5m8w-container, .framer-71fo5 .framer-29p146-container, .framer-71fo5 .framer-1wdidps, .framer-71fo5 .framer-mn4tq1, .framer-71fo5 .framer-15uy15h { flex: none; width: 100%; } .framer-71fo5 .framer-7zw2gx, .framer-71fo5 .framer-yar60u { align-self: unset; height: 2px; width: 100%; } .framer-71fo5 .framer-9884ud-container { height: 88px; } .framer-71fo5 .framer-eobjje-container { height: 78px; } .framer-71fo5 .framer-4lobi { max-width: unset; } .framer-71fo5 .framer-1xt1wio { flex-direction: column; } .framer-71fo5 .framer-11ity0d { flex-direction: column; gap: 32px; } .framer-71fo5 .framer-jei5en { align-content: center; align-items: center; flex-direction: column; justify-content: flex-start; } .framer-71fo5 .framer-fsijwq { padding: 24px; }}",
  ],
  rr = L(qa, Pa, "framer-71fo5"),
  Dn = rr;
rr.displayName = "Home";
rr.defaultProps = { height: 5843.18, width: 1200 };
P(
  rr,
  [
    {
      explicitInter: !0,
      fonts: [
        {
          family: "Inter",
          source: "framer",
          style: "normal",
          unicodeRange:
            "U+0460-052F, U+1C80-1C88, U+20B4, U+2DE0-2DFF, U+A640-A69F, U+FE2E-FE2F",
          url: "/assets/5vvr9Vy74if2I6bQbJvbw7SY1pQ.woff2",
          weight: "400",
        },
        {
          family: "Inter",
          source: "framer",
          style: "normal",
          unicodeRange: "U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116",
          url: "/assets/EOr0mi4hNtlgWNn9if640EZzXCo.woff2",
          weight: "400",
        },
        {
          family: "Inter",
          source: "framer",
          style: "normal",
          unicodeRange: "U+1F00-1FFF",
          url: "/assets/Y9k9QrlZAqio88Klkmbd8VoMQc.woff2",
          weight: "400",
        },
        {
          family: "Inter",
          source: "framer",
          style: "normal",
          unicodeRange: "U+0370-03FF",
          url: "/assets/OYrD2tBIBPvoJXiIHnLoOXnY9M.woff2",
          weight: "400",
        },
        {
          family: "Inter",
          source: "framer",
          style: "normal",
          unicodeRange:
            "U+0100-024F, U+0259, U+1E00-1EFF, U+2020, U+20A0-20AB, U+20AD-20CF, U+2113, U+2C60-2C7F, U+A720-A7FF",
          url: "/assets/JeYwfuaPfZHQhEG8U5gtPDZ7WQ.woff2",
          weight: "400",
        },
        {
          family: "Inter",
          source: "framer",
          style: "normal",
          unicodeRange:
            "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+2000-206F, U+2074, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD",
          url: "/assets/vQyevYAyHtARFwPqUzQGpnDs.woff2",
          weight: "400",
        },
        {
          family: "Inter",
          source: "framer",
          style: "normal",
          unicodeRange:
            "U+0102-0103, U+0110-0111, U+0128-0129, U+0168-0169, U+01A0-01A1, U+01AF-01B0, U+1EA0-1EF9, U+20AB",
          url: "/assets/b6Y37FthZeALduNqHicBT6FutY.woff2",
          weight: "400",
        },
        {
          family: "Inter",
          source: "framer",
          style: "normal",
          unicodeRange:
            "U+0460-052F, U+1C80-1C88, U+20B4, U+2DE0-2DFF, U+A640-A69F, U+FE2E-FE2F",
          url: "/assets/DpPBYI0sL4fYLgAkX8KXOPVt7c.woff2",
          weight: "700",
        },
        {
          family: "Inter",
          source: "framer",
          style: "normal",
          unicodeRange: "U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116",
          url: "/assets/4RAEQdEOrcnDkhHiiCbJOw92Lk.woff2",
          weight: "700",
        },
        {
          family: "Inter",
          source: "framer",
          style: "normal",
          unicodeRange: "U+1F00-1FFF",
          url: "/assets/1K3W8DizY3v4emK8Mb08YHxTbs.woff2",
          weight: "700",
        },
        {
          family: "Inter",
          source: "framer",
          style: "normal",
          unicodeRange: "U+0370-03FF",
          url: "/assets/tUSCtfYVM1I1IchuyCwz9gDdQ.woff2",
          weight: "700",
        },
        {
          family: "Inter",
          source: "framer",
          style: "normal",
          unicodeRange:
            "U+0100-024F, U+0259, U+1E00-1EFF, U+2020, U+20A0-20AB, U+20AD-20CF, U+2113, U+2C60-2C7F, U+A720-A7FF",
          url: "/assets/VgYFWiwsAC5OYxAycRXXvhze58.woff2",
          weight: "700",
        },
        {
          family: "Inter",
          source: "framer",
          style: "normal",
          unicodeRange:
            "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+2000-206F, U+2074, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD",
          url: "/assets/DXD0Q7LSl7HEvDzucnyLnGBHM.woff2",
          weight: "700",
        },
        {
          family: "Inter",
          source: "framer",
          style: "normal",
          unicodeRange:
            "U+0102-0103, U+0110-0111, U+0128-0129, U+0168-0169, U+01A0-01A1, U+01AF-01B0, U+1EA0-1EF9, U+20AB",
          url: "/assets/GIryZETIX4IFypco5pYZONKhJIo.woff2",
          weight: "700",
        },
      ],
    },
    ...$t,
    ...ra,
    ...aa,
    ...oa,
    ...ia,
    ...sa,
    ...la,
    ...da,
    ...fa,
    ...ma,
    ...ca,
    ...pa,
    ...ha,
    ...u(Le),
    ...u(Sr),
    ...u(Xe),
    ...u(ue),
    ...u(Oe),
    ...u(_r),
    ...u(ze),
    ...u(Me),
  ],
  { supportsExplicitInterCodegen: !0 },
);
var Ln = {
  exports: {
    Props: { type: "tsType", annotations: { framerContractVersion: "1" } },
    default: {
      type: "reactComponent",
      name: "FramerAhpw6p2s9",
      slots: [],
      annotations: {
        framerIntrinsicWidth: "1200",
        framerCanvasComponentVariantDetails:
          '{"propertyName":"variant","data":{"default":{"layout":["fixed","auto"]},"zH0fe2mqW":{"layout":["fixed","auto"]},"PV7eKQLeF":{"layout":["fixed","auto"]}}}',
        framerResponsiveScreen: "",
        framerContractVersion: "1",
        framerComponentViewportWidth: "true",
        framerAutoSizeImages: "true",
        framerDisplayContentsDiv: "false",
        framerImmutableVariables: "true",
        framerIntrinsicHeight: "5843.18",
        framerColorSyntax: "true",
        framerScrollSections:
          '{"akRK8f7LT":{"pattern":":akRK8f7LT","name":"hero"},"U8RVzCuQJ":{"pattern":":U8RVzCuQJ","name":"sobre-nosotros"},"Cg0eq09PA":{"pattern":":Cg0eq09PA","name":"cta"},"b5zwtctBu":{"pattern":":b5zwtctBu","name":"amt"},"lsjDsgQDk":{"pattern":":lsjDsgQDk","name":"reviews"},"wYofsySfx":{"pattern":":wYofsySfx","name":"faqs"},"otFsjtIkD":{"pattern":":otFsjtIkD","name":"footer"}}',
        framerAcceptsLayoutTemplate: "true",
      },
    },
    __FramerMetadata__: { type: "variable" },
  },
};
export { Ln as __FramerMetadata__, Dn as default };
//# sourceMappingURL=GxZSVUFmIJ-x5WD4r_Q77t2A17V5W3xh2UoF_F3gOSY.ZT4YG5DB.js.map
