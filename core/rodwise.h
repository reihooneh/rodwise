/* Rodwise: where lightning would strike a building, and which air terminals protect it.
 *
 * The building is a height field: a grid of cells, each with the height of whatever stands there and
 * what kind of thing it is. Two models of lightning run on it:
 *
 *   - The rolling sphere of AS/NZS 1768 and IEC 62305-3. A sphere of radius R (20, 30, 45 or 60 m
 *     for protection levels I to IV) is rolled over and around everything. Whatever it touches can
 *     be struck; whatever stays under it is protected. On a height field this is exactly a
 *     grey-scale morphological closing with a ball.
 *   - The electrogeometric model it comes from. A lightning leader comes down at a random place with
 *     a random peak current I, and strikes the first thing within its striking distance r = 10 I^0.65
 *     metres. Many leaders give how often each part of the building would be struck.
 *
 * The core is plain C17 with no C library in the WebAssembly build (it brings its own maths), so the
 * browser and the native tests run the same code. */
#ifndef RODWISE_H
#define RODWISE_H

#include <stddef.h>
#include <stdint.h>

#define PI 3.14159265358979323846

/* ---------- Small maths, the same natively and in WebAssembly ---------- */
double rw_sqrt(double x);
double rw_sin(double x);
double rw_cos(double x);
double rw_exp(double x);
double rw_log(double x);
double rw_fabs(double x);
double rw_ncdf(double x);

typedef struct {
  uint64_t state;
  uint64_t inc;
  int has_spare;
  double spare;
} rw_rng;
void rw_seed(rw_rng *r, uint64_t seed, uint64_t stream);
uint32_t rw_next(rw_rng *r);
double rw_uniform(rw_rng *r); /* in (0, 1) */
double rw_normal(rw_rng *r);

/* ---------- The scene ---------- */

#define RW_MAX_ELEMENTS 80
#define RW_MAX_CANDIDATES 400
#define RW_MAX_CHOSEN 40   /* air terminals a plan may add */
#define RW_MAX_GRID 320     /* cells along each side */
#define RW_MAX_CELLS (RW_MAX_GRID * RW_MAX_GRID)
#define RW_MAX_COORD 100.0  /* metres from the origin */
#define RW_MAX_HEIGHT 60.0  /* metres */

/* What a cell is. Building parts and roof fittings need protecting; trees can be struck but aren't
 * protected; air terminals are there to be struck. */
enum { RW_GROUND = 0, RW_BUILDING = 1, RW_FITTING = 2, RW_TREE = 3, RW_TERMINAL = 4 };

/* Element shapes. Each element is RW_FIELDS numbers: shape, kind, then the shape's parameters. */
enum {
  RW_BOX = 1,     /* x, y, w, d, h: a flat-topped block (x, y its south-west corner) */
  RW_GABLE = 2,   /* x, y, w, d, eave, ridge, along (0 = ridge runs east-west, 1 = north-south) */
  RW_HIP = 3,     /* x, y, w, d, eave, ridge: every side slopes at the same pitch */
  RW_CYLINDER = 4,/* cx, cy, r, h: a tank or silo */
  RW_TREE_SHAPE = 5, /* cx, cy, r, base, top: a crown, an ellipsoid dome from base to top */
  RW_POLE = 6,    /* cx, cy, h: an antenna, flagpole or chimney flue one cell across */
  RW_ROD = 7      /* cx, cy, length: an air terminal standing on whatever is below it */
};
#define RW_FIELDS 9

typedef struct {
  int nx, ny;       /* cells */
  double cell;      /* metres per cell */
  double x0, y0;    /* the south-west corner of cell (0, 0) */
  float h[RW_MAX_CELLS];
  uint8_t kind[RW_MAX_CELLS];
  int16_t element[RW_MAX_CELLS]; /* which element made the cell, or -1 */
  double minx, miny, maxx, maxy, top; /* the extent of everything that isn't ground */
} rw_scene;

/* Checks every element; returns 0, or the 1-based index of the first bad element. A scene from the
 * page has at most RW_MAX_ELEMENTS; the planner may add up to RW_MAX_CHOSEN rods to check its plan. */
int rw_check_elements(const double *el, int n);

/* Builds the height field for elements el[0..n) with a margin of `margin` metres all round (the
 * sphere needs room to roll down to the ground). The cell size is the smallest of 0.5, 1 or 2 m, and
 * at least min_cell, that fits the grid. Returns 0, or a negative error. */
int rw_build(rw_scene *s, const double *el, int n, double margin, double min_cell);

/* ---------- The rolling sphere ---------- */

typedef struct {
  double radius;
  float centre[RW_MAX_CELLS]; /* the lowest a sphere centred over each cell can sit (m) */
  float under[RW_MAX_CELLS];  /* the closing: the lowest sphere surface over each cell */
  int exposed_cells, protect_cells;
  double exposed_area, protect_area; /* m² of roof and fittings */
  int tall_walls;   /* wall cells rising more than R above the ground beside them (side flashes) */
} rw_sphere;

/* Rolls a sphere of radius R over the scene. A cell can be struck when the sphere touches it:
 * under[c] - h[c] <= RW_TOUCH. */
#define RW_TOUCH 0.005
void rw_roll(const rw_scene *s, double radius, rw_sphere *out);
/* Whether cell c can be struck, given the sphere. */
int rw_touched(const rw_scene *s, const rw_sphere *sp, int c);

/* The pieces rw_roll is made of, for the planner and the tests. */
void rw_prepare(double radius, double cell);
extern uint64_t rw_work; /* disk offsets examined since it was last reset */
void rw_dilate(const rw_scene *s, double radius, float *centre);
void rw_dilate_add(const rw_scene *s, double radius, float *centre, int i, int j, float top);
float rw_under(const rw_scene *s, const float *centre, int i, int j, int stop_on_touch);
float rw_under_with(const rw_scene *s, const float *centre, int i, int j, int ri, int rj, float top, int hint);
int rw_touch_at(const rw_scene *s, const float *centre, int i, int j);

/* The protection levels of AS/NZS 1768 and IEC 62305: sphere radius and the smallest peak current
 * a leader with that striking distance carries. */
extern const double rw_level_radius[4];
extern const double rw_level_current[4];

/* ---------- The electrogeometric model ---------- */

/* Peak current of first negative strokes: a lognormal fitted to the four interception
 * probabilities of IEC 62305-1 (99, 97, 91 and 84 % of strokes are at least 3, 5, 10 and 16 kA). */
#define RW_I_MEDIAN 55.8
#define RW_I_SIGMA 1.257
double rw_current_exceeds(double kA); /* probability a stroke's peak current is at least kA */
double rw_striking_distance(double kA); /* r = 10 I^0.65 m */

typedef struct {
  float x, y, z;    /* where it struck (m); z is 0 on the ground */
  float current;    /* kA */
  int16_t kind;     /* what it struck */
  int16_t element;
} rw_strike;

#define RW_MAX_SHOWN 400 /* strikes kept for the animation */

typedef struct {
  int leaders;
  double weight_total;           /* sum of each leader's sampling area (m²) */
  double rate[5];                /* expected strikes a year to each kind, per (flash / km² / year) */
  float density[RW_MAX_CELLS];   /* strikes a year per cell, per unit flash density */
  double small_failures;         /* strikes a year (per unit density) reaching building or fittings */
  double max_failure_current;    /* the largest peak current (kA) of any that did */
  double element_rate[RW_MAX_ELEMENTS + RW_MAX_CHOSEN];
  int shown;
  rw_strike strikes[RW_MAX_SHOWN];
} rw_egm;

/* Sends `leaders` leaders down at random over the scene (seeded, so repeatable). Each leader picks a
 * current, then a place uniformly over the scene's extent widened by its own striking distance, and
 * is weighted by that area, which makes every rate an unbiased estimate. */
void rw_strikes(const rw_scene *s, int leaders, uint32_t seed, rw_egm *out);

/* IEC 62305-2: the collection area of an isolated rectangular building, L·W + 6H(L+W) + 9πH². */
double rw_iec_area(double L, double W, double H);
/* Ng from thunder days, for Australia (Kuleshov et al.): Ng = 0.012 Td^1.4. */
double rw_ng_from_thunder_days(double td);

/* ---------- Planning air terminals ---------- */


typedef struct {
  double lengths[4];   /* rod lengths on offer (m) */
  double costs[4];     /* installed cost of each, including its share of down conductor */
  int nlengths;
  double spacing;      /* metres between candidate places on the roof */
} rw_plan_options;

typedef struct {
  int chosen;
  double x[RW_MAX_CHOSEN], y[RW_MAX_CHOSEN], length[RW_MAX_CHOSEN], cost[RW_MAX_CHOSEN];
  double total_cost;
  int exposed_before, exposed_after;   /* cells of building and fittings the sphere touches */
  int candidates;
  int evaluations;
  int complete;   /* 0 if the work limit stopped the search early */
} rw_plan;

/* The planner stops adding rods once it has examined this many disk offsets (a few seconds), so the
 * largest site allowed can't hang it. Whatever it has placed by then is still checked and reported. */
#define RW_WORK_LIMIT 1000000000ULL

/* Chooses air terminals for the elements el[0..n) so the sphere touches no building or fitting cell,
 * as cheaply as it can: a greedy pass on a 1 m grid (the most newly protected roof per dollar), then
 * dropping any terminal the others make unnecessary and shortening what can be shortened, then a
 * check on the fine grid with a top-up if a sliver is still exposed. el must have room for
 * RW_MAX_CHOSEN more elements: the plan's rods are appended there for the check. Returns 0, or a
 * negative error. */
int rw_plan_terminals(double *el, int n, double radius, const rw_plan_options *opt, rw_plan *out);

#endif
