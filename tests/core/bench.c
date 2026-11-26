/* Times the core on the example house: build, roll, strikes, plan. */
#define _POSIX_C_SOURCE 199309L
#include <stdio.h>
#include <time.h>
#include "../../core/rodwise.h"

static double now(void) {
  struct timespec t;
  clock_gettime(CLOCK_MONOTONIC, &t);
  return (double)t.tv_sec + (double)t.tv_nsec * 1e-9;
}

static rw_scene g_s;
static rw_sphere g_sp;
static rw_egm g_egm;

int main(void) {
  double el[(7 + RW_MAX_CHOSEN) * RW_FIELDS] = {
      RW_GABLE, RW_BUILDING, 0, 0, 14, 9, 6.0, 8.5, 0,
      RW_GABLE, RW_BUILDING, 14, 0, 6, 7, 3.0, 4.5, 1,
      RW_BOX, RW_BUILDING, 3, 6.5, 0.8, 0.8, 9.4, 0, 0,
      RW_POLE, RW_FITTING, 10, 4.5, 11, 0, 0, 0, 0,
      RW_CYLINDER, RW_FITTING, 21.5, 8.5, 1.2, 2.2, 0, 0, 0,
      RW_TREE_SHAPE, RW_TREE, -6, 12, 5, 4, 18, 0, 0,
  };
  const int n = 6;
  for (int lvl = 0; lvl < 4; lvl++) {
    const double R = rw_level_radius[lvl];
    double t = now();
    rw_build(&g_s, el, n, R, 0.5);
    double t1 = now();
    rw_roll(&g_s, R, &g_sp);
    double t2 = now();
    printf("R=%g grid %dx%d cell %g: build %.3f s, roll %.3f s, exposed %d of %d cells, tall walls %d\n", R, g_s.nx,
           g_s.ny, g_s.cell, t1 - t, t2 - t1, g_sp.exposed_cells, g_sp.protect_cells, g_sp.tall_walls);
  }
  double t = now();
  rw_strikes(&g_s, 20000, 7, &g_egm);
  printf("strikes 20000: %.3f s; per (1/km²/yr): building %.4f fitting %.4f tree %.4f terminal %.4f\n", now() - t,
         g_egm.rate[RW_BUILDING], g_egm.rate[RW_FITTING], g_egm.rate[RW_TREE], g_egm.rate[RW_TERMINAL]);
  printf("IEC area of the main body (14x9x8.5): %.0f m² -> %.4f per (1/km²/yr)\n", rw_iec_area(14, 9, 8.5),
         rw_iec_area(14, 9, 8.5) * 1e-6);
  rw_plan_options o = {.lengths = {0.6, 1.5, 3.0}, .costs = {450, 650, 1100}, .nlengths = 3, .spacing = 2};
  for (int lvl = 0; lvl < 4; lvl++) {
    rw_plan p;
    t = now();
    int rc = rw_plan_terminals(el, n, rw_level_radius[lvl], &o, &p);
    printf("plan R=%g: rc %d, %.2f s, %d rods $%.0f, exposed %d -> %d, %d candidates, %d evaluations\n",
           rw_level_radius[lvl], rc, now() - t, p.chosen, p.total_cost, p.exposed_before, p.exposed_after, p.candidates,
           p.evaluations);
    for (int k = 0; k < p.chosen; k++) printf("   rod %.2f m at (%.1f, %.1f)\n", p.length[k], p.x[k], p.y[k]);
  }
  return 0;
}
