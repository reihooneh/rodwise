/* Tests for the Rodwise core: the maths against the C library, the rolling sphere against geometry
 * worked out by hand, the electrogeometric model against an exact integral, the planner's promises,
 * and hostile elements. Built with AddressSanitizer and UBSan. */
#include <math.h>
#include <stdio.h>
#include <string.h>

#include "../../core/rodwise.h"

static int g_fail = 0, g_pass = 0;
#define CHECK(cond, ...)                 \
  do {                                   \
    if (cond) {                          \
      g_pass++;                          \
    } else {                             \
      g_fail++;                          \
      printf("FAIL %s:%d: ", __FILE__, __LINE__); \
      printf(__VA_ARGS__);               \
      printf("\n");                      \
    }                                    \
  } while (0)

static rw_scene g_s;
static rw_sphere g_sp;
static rw_egm g_egm;
static double g_el[(RW_MAX_ELEMENTS + RW_MAX_CHOSEN) * RW_FIELDS];

static void set(int i, double a, double b, double c, double d, double e, double f, double g, double h, double k) {
  double *x = g_el + (size_t)i * RW_FIELDS;
  x[0] = a; x[1] = b; x[2] = c; x[3] = d; x[4] = e; x[5] = f; x[6] = g; x[7] = h; x[8] = k;
}

static void test_maths(void) {
  double worst = 0;
  for (double x = -50; x <= 50; x += 0.37) {
    worst = fmax(worst, fabs(rw_sin(x) - sin(x)));
    worst = fmax(worst, fabs(rw_cos(x) - cos(x)));
    worst = fmax(worst, fabs(rw_exp(x / 5) - exp(x / 5)) / exp(x / 5));
    worst = fmax(worst, fabs(rw_ncdf(x / 8) - 0.5 * erfc(-x / 8 / sqrt(2))));
  }
  for (double x = 1e-6; x < 1e6; x *= 1.7) {
    worst = fmax(worst, fabs(rw_log(x) - log(x)));
    worst = fmax(worst, fabs(rw_sqrt(x) - sqrt(x)) / sqrt(x));
  }
  CHECK(worst < 1e-12, "maths differs from the C library by %g", worst);
}

/* The four protection levels: the striking distance of the level's minimum current is the level's
 * sphere radius, and the fitted current distribution gives the standard's interception rates. */
static void test_levels(void) {
  static const double share[4] = {0.99, 0.97, 0.91, 0.84};
  for (int l = 0; l < 4; l++) {
    const double r = rw_striking_distance(rw_level_current[l]);
    CHECK(fabs(r - rw_level_radius[l]) < 2.0, "level %d: r(%g kA) = %.1f m, not %g", l + 1, rw_level_current[l], r,
          rw_level_radius[l]);
    const double p = rw_current_exceeds(rw_level_current[l]);
    CHECK(fabs(p - share[l]) < 0.006, "level %d: %.3f of strokes above %g kA, not %.2f", l + 1, p, rw_level_current[l],
          share[l]);
  }
  CHECK(fabs(rw_ng_from_thunder_days(30) - 0.012 * pow(30, 1.4)) < 1e-9, "Ng from thunder days");
  CHECK(fabs(rw_iec_area(10, 10, 10) - (100 + 1200 + 900 * PI)) < 1e-9, "IEC collection area");
}

/* A rod of length L standing on a big flat roof protects a disc of radius sqrt(L (2R - L)) around it:
 * the sphere resting on the rod's tip and the roof touches the roof that far out. */
static void test_rod_on_flat_roof(void) {
  for (int l = 1; l < 4; l++) {
    const double R = rw_level_radius[l], L = 1.5;
    set(0, RW_BOX, RW_BUILDING, -30, -30, 60, 60, 10, 0, 0);
    set(1, RW_ROD, RW_TERMINAL, 0.25, 0.25, L, 0, 0, 0, 0);
    CHECK(rw_build(&g_s, g_el, 2, R, 0.5) == 0, "build");
    rw_roll(&g_s, R, &g_sp);
    const double want = sqrt(L * (2 * R - L));
    int wrong = 0;
    for (int j = 0; j < g_s.ny; j++)
      for (int i = 0; i < g_s.nx; i++) {
        const int c = j * g_s.nx + i;
        if (g_s.kind[c] != RW_BUILDING) continue;
        const double x = g_s.x0 + (i + 0.5) * g_s.cell - 0.25, y = g_s.y0 + (j + 0.5) * g_s.cell - 0.25;
        const double d = sqrt(x * x + y * y);
        if (fabs(d - want) < 0.6 || d > 28) continue; /* the boundary itself, and the roof's own edge */
        if ((d < want) == rw_touched(&g_s, &g_sp, c)) wrong++;
      }
    CHECK(wrong == 0, "R=%g: %d roof cells on the wrong side of the %.2f m protected circle", R, wrong, want);
  }
}

/* Two long walls of height h, 2d apart: the sphere resting on both sags to h + sqrt(R² - d²) - R
 * at the middle, so a box there is protected just below that height and exposed above it. (Two
 * masts would not do: the sphere comes in from the side, between them.) */
static void test_two_walls(void) {
  const double R = 45, h = 20, d = 15;
  const double sag = h + sqrt(R * R - d * d) - R; /* lowest point of the sphere between the walls */
  for (int k = 0; k < 2; k++) {
    const double box = k == 0 ? sag - 0.2 : sag + 0.2;
    set(0, RW_BOX, RW_TERMINAL, -d - 0.25, -30, 0.5, 60, h, 0, 0);
    set(1, RW_BOX, RW_TERMINAL, d - 0.25, -30, 0.5, 60, h, 0, 0);
    set(2, RW_BOX, RW_FITTING, -0.5, -0.5, 1, 1, box, 0, 0);
    CHECK(rw_build(&g_s, g_el, 3, R, 0.5) == 0, "build");
    rw_roll(&g_s, R, &g_sp);
    CHECK(g_sp.exposed_cells == (k == 0 ? 0 : g_sp.protect_cells), "box %.2f m with the sag at %.2f m: %d of %d exposed",
          box, sag, g_sp.exposed_cells, g_sp.protect_cells);
  }
}

/* A bare gable roof is convex: the sphere touches all of it. Every touched cell really is touched by
 * a sphere that nothing pokes into. */
static void test_gable_and_witness(void) {
  set(0, RW_GABLE, RW_BUILDING, 0, 0, 14, 9, 6, 8.5, 0);
  set(1, RW_GABLE, RW_BUILDING, 14, 0, 6, 7, 3, 4.5, 1);
  set(2, RW_TREE_SHAPE, RW_TREE, 70, 60, 4, 3, 12, 0, 0); /* far off: it shields nothing */
  CHECK(rw_build(&g_s, g_el, 3, 45, 0.5) == 0, "build");
  rw_roll(&g_s, 45, &g_sp);
  int main_exposed = 0, main_cells = 0;
  for (int c = 0; c < g_s.nx * g_s.ny; c++)
    if (g_s.element[c] == 0) {
      main_cells++;
      main_exposed += rw_touched(&g_s, &g_sp, c);
    }
  CHECK(main_exposed == main_cells, "main gable: %d of %d cells exposed", main_exposed, main_cells);
  /* Witness: for each exposed cell, find the touching centre and check no cell top lies inside. */
  int bad = 0, checked = 0;
  const double R = 45, cell = g_s.cell;
  for (int c = 0; c < g_s.nx * g_s.ny && checked < 300; c += 3) {
    if (g_s.kind[c] != RW_BUILDING || !rw_touched(&g_s, &g_sp, c)) continue;
    checked++;
    const int pi = c % g_s.nx, pj = c / g_s.nx;
    int found = 0;
    for (int dj = -90; dj <= 90 && !found; dj++)
      for (int di = -90; di <= 90 && !found; di++) {
        const int x = pi + di, y = pj + dj;
        if (x < 0 || y < 0 || x >= g_s.nx || y >= g_s.ny) continue;
        const double d2 = (di * di + dj * dj) * cell * cell;
        if (d2 > R * R) continue;
        const double zc = g_sp.centre[y * g_s.nx + x];
        if (fabs(zc - sqrt(R * R - d2) - g_s.h[c]) > RW_TOUCH) continue;
        found = 1;
        /* Nothing may be inside this sphere (beyond rounding). */
        for (int q = 0; q < g_s.nx * g_s.ny; q++) {
          if (g_s.h[q] <= 0) continue;
          const double ex = (q % g_s.nx - x) * cell, ey = (q / g_s.nx - y) * cell, ez = g_s.h[q] - zc;
          if (ex * ex + ey * ey + ez * ez < (R - 0.02) * (R - 0.02)) {
            bad++;
            break;
          }
        }
      }
    if (!found) bad++;
  }
  CHECK(checked > 30 && bad == 0, "%d of %d touched cells have no clean touching sphere", bad, checked);
}

/* Adding anything never exposes a cell that was protected (the planner relies on this). */
static void test_monotone(void) {
  rw_rng r;
  rw_seed(&r, 9, 1);
  static float before[RW_MAX_CELLS];
  for (int t = 0; t < 12; t++) {
    int n = 0;
    set(n++, RW_HIP, RW_BUILDING, 0, 0, 10 + 10 * rw_uniform(&r), 8 + 8 * rw_uniform(&r), 3, 6, 0);
    set(n++, RW_BOX, RW_FITTING, 2 + 4 * rw_uniform(&r), 2 + 4 * rw_uniform(&r), 1, 1, 5.5 + rw_uniform(&r), 0, 0);
    const double R = rw_level_radius[t % 4];
    rw_build(&g_s, g_el, n, R, 0.5);
    rw_roll(&g_s, R, &g_sp);
    for (int c = 0; c < g_s.nx * g_s.ny; c++) before[c] = g_sp.under[c] - g_s.h[c];
    set(n++, RW_ROD, RW_TERMINAL, 1 + 8 * rw_uniform(&r), 1 + 6 * rw_uniform(&r), 0.5 + 2 * rw_uniform(&r), 0, 0, 0, 0);
    rw_build(&g_s, g_el, n, R, 0.5);
    rw_roll(&g_s, R, &g_sp);
    int worse = 0;
    for (int c = 0; c < g_s.nx * g_s.ny; c++)
      if ((g_s.kind[c] == RW_BUILDING || g_s.kind[c] == RW_FITTING) && before[c] > (float)RW_TOUCH &&
          g_sp.under[c] - g_s.h[c] <= (float)RW_TOUCH)
        worse++;
    CHECK(worse == 0, "trial %d: a rod exposed %d cells", t, worse);
  }
}

/* The electrogeometric model on a lone mast of height h: a leader with striking distance r hits it
 * from anywhere within sqrt(2rh - h²) (or r, when r < h), so the expected collection area is an
 * integral over the current distribution. The Monte Carlo must agree with it. */
static void test_egm_mast(void) {
  const double h = 25;
  set(0, RW_POLE, RW_TERMINAL, 0.25, 0.25, h, 0, 0, 0, 0);
  CHECK(rw_build(&g_s, g_el, 1, 10, 0.5) == 0, "build");
  rw_strikes(&g_s, 200000, 3, &g_egm);
  double exact = 0;
  const int N = 20000;
  for (int k = 0; k < N; k++) { /* midpoint rule over the normal quantiles */
    const double z = -6 + 12 * (k + 0.5) / N;
    const double w = exp(-z * z / 2) / sqrt(2 * PI) * 12.0 / N;
    double I = RW_I_MEDIAN * exp(RW_I_SIGMA * z);
    I = I < 2 ? 2 : I > 400 ? 400 : I;
    const double r = rw_striking_distance(I);
    exact += w * PI * (r > h ? 2 * r * h - h * h : r * r);
  }
  exact *= 1e-6;
  const double got = g_egm.rate[RW_TERMINAL];
  CHECK(fabs(got - exact) / exact < 0.02, "lone %g m mast: Monte Carlo %.5f, exact %.5f strikes/yr per unit Ng", h, got,
        exact);
}

/* A rod protects what it should from the strikes too: shielding failures need small currents. */
static void test_egm_shielding(void) {
  set(0, RW_BOX, RW_BUILDING, 0, 0, 12, 8, 6, 0, 0);
  set(1, RW_ROD, RW_TERMINAL, 6, 4, 3, 0, 0, 0, 0);
  rw_build(&g_s, g_el, 2, 45, 0.5);
  rw_strikes(&g_s, 60000, 5, &g_egm);
  const double total = g_egm.rate[RW_BUILDING] + g_egm.rate[RW_TERMINAL];
  CHECK(g_egm.rate[RW_TERMINAL] > 0.5 * total, "the rod takes %.0f %% of strikes", 100 * g_egm.rate[RW_TERMINAL] / total);
  int big = 0;
  for (int k = 0; k < g_egm.shown; k++)
    if (g_egm.strikes[k].kind == RW_BUILDING && g_egm.strikes[k].current > 200) big++;
  CHECK(big == 0, "%d very large strokes got past the rod", big);
}

static int exposed_count(int n, double R) {
  rw_build(&g_s, g_el, n, R, 0.5);
  rw_roll(&g_s, R, &g_sp);
  return g_sp.exposed_cells;
}

/* The planner protects everything, and every rod it keeps is needed. */
static void test_planner(void) {
  int n = 0;
  set(n++, RW_GABLE, RW_BUILDING, 0, 0, 14, 9, 6.0, 8.5, 0);
  set(n++, RW_GABLE, RW_BUILDING, 14, 0, 6, 7, 3.0, 4.5, 1);
  set(n++, RW_BOX, RW_BUILDING, 3, 6.5, 0.8, 0.8, 9.4, 0, 0);
  set(n++, RW_POLE, RW_FITTING, 10, 4.5, 11, 0, 0, 0, 0);
  set(n++, RW_CYLINDER, RW_FITTING, 21.5, 8.5, 1.2, 2.2, 0, 0, 0);
  rw_plan_options o = {.lengths = {0.6, 1.5, 3.0}, .costs = {450, 650, 1100}, .nlengths = 3, .spacing = 2};
  for (int l = 0; l < 4; l++) {
    const double R = rw_level_radius[l];
    rw_plan p;
    CHECK(rw_plan_terminals(g_el, n, R, &o, &p) == 0, "plan");
    CHECK(p.exposed_after == 0 && p.chosen > 0, "R=%g: %d cells still exposed", R, p.exposed_after);
    for (int k = 0; k < p.chosen; k++)
      set(n + k, RW_ROD, RW_TERMINAL, p.x[k], p.y[k], p.length[k], 0, 0, 0, 0);
    CHECK(exposed_count(n + p.chosen, R) == 0, "R=%g: the plan leaves cells exposed", R);
    int needed = 1;
    for (int skip = 0; skip < p.chosen; skip++) {
      int m = n;
      for (int k = 0; k < p.chosen; k++)
        if (k != skip) set(m++, RW_ROD, RW_TERMINAL, p.x[k], p.y[k], p.length[k], 0, 0, 0, 0);
      if (exposed_count(m, R) == 0) needed = 0;
    }
    CHECK(needed, "R=%g: a rod in the plan isn't needed", R);
    double sum = 0;
    for (int k = 0; k < p.chosen; k++) sum += p.cost[k];
    CHECK(fabs(sum - p.total_cost) < 1e-9, "cost adds up");
  }
  /* Planning a bad set of options is refused. */
  rw_plan p;
  rw_plan_options bad = o;
  bad.costs[1] = 0;
  CHECK(rw_plan_terminals(g_el, n, 45, &bad, &p) != 0, "zero cost refused");
  bad = o;
  bad.lengths[2] = 1.0;
  CHECK(rw_plan_terminals(g_el, n, 45, &bad, &p) != 0, "lengths out of order refused");
  CHECK(rw_plan_terminals(g_el, n, 500, &o, &p) != 0, "huge radius refused");
}

/* The largest site allowed, 80 roofs filling it, can't hang the planner: the work limit stops it,
 * and it says so. */
static void test_planner_bounded(void) {
  int n = 0;
  for (int a = 0; a < 8; a++)
    for (int b = 0; b < 10; b++, n++)
      set(n, RW_GABLE, RW_BUILDING, -100 + a * 25, -100 + b * 20, 20, 15, 4 + a + b, 7 + a + b, (a + b) % 2);
  rw_plan_options o = {.lengths = {0.6, 1.5, 3.0}, .costs = {450, 650, 1100}, .nlengths = 3, .spacing = 1};
  rw_plan p;
  CHECK(rw_plan_terminals(g_el, n, 60, &o, &p) == 0, "plan the largest site");
  CHECK(!p.complete && p.exposed_after <= p.exposed_before && rw_work < 3 * RW_WORK_LIMIT,
        "the work limit stops it: complete %d, work %.2g", p.complete, (double)rw_work);
}

static void test_hostile(void) {
  const double nan = NAN, inf = INFINITY;
  set(0, RW_BOX, RW_BUILDING, 0, 0, 10, 10, 5, 0, 0);
  CHECK(rw_check_elements(g_el, 1) == 0, "a good box");
  CHECK(rw_check_elements(g_el, 0) != 0 && rw_check_elements(g_el, RW_MAX_ELEMENTS + RW_MAX_CHOSEN + 1) != 0, "counts");
  const double bad[][RW_FIELDS] = {
      {RW_BOX, RW_BUILDING, nan, 0, 10, 10, 5, 0, 0},
      {RW_BOX, RW_BUILDING, 0, 0, inf, 10, 5, 0, 0},
      {RW_BOX, RW_BUILDING, 0, 0, 10, 10, -5, 0, 0},
      {RW_BOX, RW_BUILDING, 95, 0, 10, 10, 5, 0, 0},
      {RW_BOX, RW_BUILDING, 0, 0, 10, 10, 61, 0, 0},
      {RW_BOX, 9, 0, 0, 10, 10, 5, 0, 0},
      {RW_BOX, 1.5, 0, 0, 10, 10, 5, 0, 0},
      {8, RW_BUILDING, 0, 0, 10, 10, 5, 0, 0},
      {RW_GABLE, RW_BUILDING, 0, 0, 10, 10, 6, 5, 0},
      {RW_GABLE, RW_BUILDING, 0, 0, 10, 10, 5, 6, 2},
      {RW_TREE_SHAPE, RW_TREE, 0, 0, 5, 10, 10, 0, 0},
      {RW_ROD, RW_TERMINAL, 0, 0, 50, 0, 0, 0, 0},
      {RW_CYLINDER, RW_FITTING, 0, 0, 0, 3, 0, 0, 0},
      {RW_POLE, RW_FITTING, 0, 0, 1e300, 0, 0, 0, 0},
  };
  for (size_t k = 0; k < sizeof bad / sizeof bad[0]; k++) {
    memcpy(g_el, bad[k], sizeof bad[k]);
    CHECK(rw_check_elements(g_el, 1) != 0, "bad element %zu accepted", k);
    CHECK(rw_build(&g_s, g_el, 1, 20, 0.5) != 0, "bad element %zu built", k);
  }
  /* The biggest scene allowed still fits the grid, with coarser cells. */
  set(0, RW_BOX, RW_BUILDING, -100, -100, 200, 200, 60, 0, 0);
  CHECK(rw_build(&g_s, g_el, 1, 80, 0.5) == 0 && g_s.cell == 2.0 && g_s.nx <= RW_MAX_GRID, "biggest scene: cell %g",
        g_s.cell);
  rw_roll(&g_s, 60, &g_sp);
  CHECK(g_sp.tall_walls == 0, "a 60 m block on flat ground has walls taller than R=60? %d", g_sp.tall_walls);
  rw_roll(&g_s, 20, &g_sp);
  CHECK(g_sp.tall_walls > 0, "a 60 m block has walls taller than R=20 (side flashes)");
}

int main(void) {
  test_maths();
  test_levels();
  test_rod_on_flat_roof();
  test_two_walls();
  test_gable_and_witness();
  test_monotone();
  test_egm_mast();
  test_egm_shielding();
  test_planner();
  test_planner_bounded();
  test_hostile();
  printf("%d passed, %d failed\n", g_pass, g_fail);
  return g_fail != 0;
}
