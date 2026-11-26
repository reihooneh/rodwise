# Security

Please report a security problem privately to Reihaneh Rahmati (reihaneh26686@gmail.com), not in a
public issue. I'll reply within a week.

## Threat model

Rodwise is a static site. Its only inputs are a building file (JSON) the visitor chooses, read in
their own browser, and a few settings. There is no server, account or database.

| An attacker could try | What stops it |
|---|---|
| A building file with HTML or script in a name, to run code in the page (XSS) | Names must match a short allow-list pattern (letters, digits and simple punctuation), so `<`, `>`, `"` and control characters are refused outright. Nothing from a file is ever inserted as markup: the pages build everything with `textContent` and DOM calls. A strict CSP (`default-src 'none'`, scripts only from the site, no inline code) would block injected script anyway. A browser test loads a file named `<img src=x onerror=…>` and checks it is refused and no image appears. |
| Numbers that break the model: NaN, infinity, huge or negative values, wrong types | The page checks every field, with type, finiteness and a physical range for each. The C core checks every number again at the WebAssembly boundary (`rw_check_elements`), because the boundary is where trust ends. Tests send NaN, infinity, `1e999`, strings, unknown shapes and kinds, and out-of-range values to both layers. |
| Writing outside a buffer in the WebAssembly module | Inputs go into one fixed buffer, sized for the maximum elements plus planned rods. Every count is checked before use, grid indices are bounds-checked with unsigned comparisons, and memory is fixed at 32 MB and never grows. The native build of the same code runs the tests under AddressSanitizer and UBSan, and clang-tidy runs in CI. |
| A file that hangs or exhausts the browser (denial of service) | The file must be 64 KB or less. Limits: at most 80 elements, a 320 × 320 grid (cells grow to 1 or 2 m for big sites), 1,000 to 400,000 leaders, 400 rod candidates and 40 rods. The planner counts the work it does and stops adding rods at a fixed limit. On a test site filling the whole allowed area with 80 roofs, it stops after about 6 s natively and reports the plan as incomplete. The heaviest example plans in about 2 s. The model runs in a Web Worker, so the page stays responsive. |
| Prototype pollution through `__proto__` keys | Fields are read by name and copied into fresh objects; unknown keys are ignored. A test parses a file with a `__proto__` key and checks nothing was polluted. |
| Tampering with what one page hands to the next | The hand-off lives in this tab's `sessionStorage`. It is re-checked on read through the same building checks, with an allow-list for the level and a range for thunder days. Anything else is ignored. |
| Supply-chain attacks | There are no runtime dependencies beyond self-hosted, pinned three.js 0.170.0 and two fonts, copied from the npm lockfile at build time. There is no CDN, analytics or third-party request, and a browser test fails if any request leaves the site. `npm audit` runs in CI. The C core uses no libraries at all. |

## Known limits

- Rodwise is a tool for understanding lightning protection, not a design. A real system must be
  designed and installed to AS/NZS 1768 or IEC 62305 by a qualified professional.
- GitHub Pages sets the HTTPS and caching headers. The CSP is delivered as a `<meta>` tag, so
  `frame-ancestors` can't be set and the site could be framed by another page. It has no sensitive
  actions to click-jack.
