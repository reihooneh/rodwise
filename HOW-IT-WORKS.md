# How Rodwise works

## Architecture

The page never does the physics. It checks the building file, turns it into rows of numbers, and
hands them to a Web Worker running the C core as WebAssembly. The worker copies the results out
(the module's memory is never shared with the page), and the page draws them with three.js, a canvas
plan view and plain DOM.

```
core/                 C17, built natively for the tests and freestanding for WebAssembly
  rodwise.h           the whole interface, with the maths explained in comments
  maths.c             exp, log, sin, cos, the normal CDF, a PCG32 random generator (no libc)
  scene.c             checking elements; rasterising boxes, gable and hip roofs, tanks, trees, poles, rods
  sphere.c            the disk of offsets (nearest first), dilation, closing, touch tests, side flashes
  strike.c            the electrogeometric Monte Carlo, collection areas, Ng from thunder days
  plan.c              greedy planner, cleanup, fine-grid check, top-up, final cleanup
  wasm.c              the WebAssembly exports: fixed buffers, everything re-checked
site/assets/js/
  common.js           building file checks, protection levels, formats, page hand-off
  worker.js engine.js the Worker and the page's side of it
  scene3d.js          three.js: roofs coloured by the sphere, the rolling sphere, bolts, rods
  planview.js         the canvas plan view
  home.js check.js protect.js method.js   one per page
src/pages/            page bodies; scripts/build.mjs wraps them in the layout with a strict CSP
tests/core/           C tests (sanitizers) and a benchmark
tests/engine/         the WebAssembly interface from Node
tests/web/            Playwright at three sizes
```

## Key concepts, simply

**The rolling sphere.** A lightning leader comes down from the cloud, and strikes the first thing
that comes within its *striking distance* r = 10 I^0.65 m, where I is the peak current in kA.
Imagine every possible leader tip as the centre of a sphere of radius r. A point can be struck
only if such a sphere can touch it without anything poking into it. Rolling the sphere over the
site finds exactly those points.

**Why a closing.** On a height field h, the lowest a sphere centred over cell c can sit is
`centre(c) = max(R, max_s h(s) + √(R² − |c−s|²))`. That is a grey-scale *dilation*, with the
lone R standing for the ground. The lowest its underside reaches over cell p is
`under(p) = min_c centre(c) − √(R² − |c−p|²)`, an *erosion* of the dilation. Together they make a
*closing*. A cell is touched exactly when `under(p) = h(p)`, and `under(p) − h(p)` is how deep under
the sphere it sits. There is no sampling of sphere positions and no tolerance to tune.

**Making it fast.** The disk of offsets is precomputed once per (R, cell size), sorted nearest-first
with a counting sort. Asking "is this cell touched?" can then stop at the first resting place that
touches it, and that is usually very close.

**The electrogeometric model.** Each leader draws a peak current from a lognormal (median
55.8 kA, σ = 1.257), fitted so that 99, 97, 91 and 84% of strokes exceed the 3, 5, 10 and 16 kA of
levels I to IV, as IEC 62305-1 states. It comes down at a random point and strikes the cell with
the largest `h + √(r² − d²)`, or the ground if nothing beats r. The point is drawn uniformly over
the building's extent widened by r, and weighted by that area. That makes the average an unbiased
collection area, and multiplied by the ground flash density it gives strikes per year.

**The planner.** Adding a rod adds a cap to the dilation, so `centre` can only rise, and so can
`under`. A protected cell stays protected whatever else is added. The planner uses that throughout:

- Each greedy round only re-checks cells that are still exposed.
- It skips any candidate that couldn't beat the best even if it protected everything.
- It stops counting a candidate once it can't win.
- It first tries, for each exposed cell, the resting place that touched it last round, because that
  place usually still touches it.

After the greedy pass, it drops redundant rods and shortens the rest. It then checks the plan on the
half-metre grid, tops it up from the cells still exposed there, and drops redundant rods again.
That last cleanup starts from the bare building's dilation plus the other rods' caps, rather than
rebuilding the scene from scratch.

## Trade-offs

- **2.5D, not 3D.** A height field can't represent overhangs or strikes to the side of a wall. Walls
  taller than R above their surroundings are flagged instead of coloured. In return, the closing is
  exact and fast.
- **Fattened cells.** A cell takes the highest point of anything that overlaps it, so thin parapets
  and ridges never fall between grid points. This shifts geometry by at most half a cell, always
  upwards, which errs on the side of exposure.
- **Greedy, not optimal.** Choosing rods is a set-cover problem, and NP-hard. The planner promises a
  plan that protects everything, with no unnecessary rod. It does not promise the cheapest possible
  plan.
- **Vertical leaders, ground with the same striking distance.** These are the textbook electrogeometric
  assumptions. They make the model a close match to the sphere, but real leaders wander.

## Interview questions

**1. Why is the rolling sphere a morphological closing, and why does that matter?**
A sphere resting on the height field is a ball sitting on top of the dilated surface. Its underside
traces the erosion of that dilation, which is the closing. Seeing it this way turns a geometric
search over sphere positions into two passes with a fixed kernel. The answer is then exact on the
grid, with no positions to sample and no tolerance to tune. It also makes properties provable: the
closing is *monotone* (adding material can only raise it), and the planner is built on exactly that.

**2. How do you test something whose right answer you don't know?**
Find cases where you do know it. A rod on a flat roof must protect a disc of radius √(L(2R−L)). Two
long walls must let the sphere sag to h + √(R² − d²) − R between them. A lone mast's collection area
has an exact integral. Then add properties that must always hold: adding a rod never exposes
anything, and every cell marked touched has a sphere that touches it with nothing inside. That last
"witness" test is how I caught that two masts *don't* protect the point between them, because the
sphere comes in from the side.

**3. The Monte Carlo samples a different area for each leader. Why is it still unbiased?**
For a leader with striking distance r, only points within r of the building's footprint can reach
it. Sampling uniformly over that rectangle (area A(r)) and scoring A(r) for a hit gives, for that
current, exactly the collection area in expectation. Averaging over currents drawn from the
distribution then gives the expected area over currents. Adapting the area to r avoids wasting
leaders far from the building when r is small, without biasing the result when r is large. The test
against the exact integral for a mast agrees within 2%.

**4. The planner was 20 seconds on the apartment block. How did you get it to under 2?**
I profiled it by phase before changing anything. The time was going to checking cells that stay
exposed: each check scanned the whole disk before discovering it was still touched. Three changes
fixed it:

- Try the resting place that touched each cell last round first, which usually answers at once.
- Stop counting a candidate once even protecting every remaining cell couldn't beat the best.
- In the fine-grid top-up, only consider the cells still exposed as places for rods.

The final redundancy check also became incremental: the bare building's dilation, plus the caps of
the other rods, instead of rebuilding the scene for each rod.

**5. What would you need before anyone used this for a real design?**
- Real geometry: imported footprints, sloped ground, overhangs, which means a 3D closing on a voxel
  grid or a mesh.
- The other air-termination methods: meshes, catenary wires and the protection-angle method.
- The rest of the system: down conductors, separation distances, earthing and bonding, where many
  failures really happen.
- The full AS/NZS 1768 risk assessment.
- Validation against designs by certified engineers.

Until then it's a tool for understanding and discussing protection, and the site says so on every
page.

## Extension ideas

1. **Exact optimisation.** Formulate rod placement as an integer program over candidates and their
   protected sets. Because protection is supermodular, it needs lazy constraints. It would measure
   how far the greedy plan is from optimal.
2. **A 3D closing.** Use a voxel grid with a ball kernel, done separably as a distance transform, to
   handle overhangs, balconies and side flashes properly.
3. **Risk-based level choice.** Combine the strike rates with AS/NZS 1768's risk components to
   recommend the protection level, instead of asking the user to pick one.
