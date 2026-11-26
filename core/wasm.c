/* The WebAssembly interface. The page writes element numbers into a fixed buffer and calls these
 * functions; every element is checked again here, so a bad call gets an error code, never a write
 * outside a buffer. Memory is fixed at build time and never grows. */
#include "rodwise.h"

#define EXPORT(name) __attribute__((export_name(#name)))

static double g_el[(RW_MAX_ELEMENTS + RW_MAX_CHOSEN) * RW_FIELDS];
static rw_scene g_scene;
static rw_sphere g_sphere;
static rw_egm g_egm;
static int g_ready = 0; /* a scene has been built and rolled */
static double g_plan_out[7 + 4 * RW_MAX_CHOSEN];
static double g_info[16];

/* The compiler may call these for structure initialisation; there is no C library to provide them. */
void *memset(void *d, int c, size_t n) {
  unsigned char *p = d;
  while (n--) *p++ = (unsigned char)c;
  return d;
}
void *memcpy(void *d, const void *s, size_t n) {
  unsigned char *p = d;
  const unsigned char *q = s;
  while (n--) *p++ = *q++;
  return d;
}

EXPORT(rw_w_elements) double *rw_w_elements(void) { return g_el; }
EXPORT(rw_w_fields) int rw_w_fields(void) { return RW_FIELDS; }
EXPORT(rw_w_max_elements) int rw_w_max_elements(void) { return RW_MAX_ELEMENTS; }
EXPORT(rw_w_level_radius) double rw_w_level_radius(int i) { return i >= 0 && i < 4 ? rw_level_radius[i] : 0; }
EXPORT(rw_w_level_current) double rw_w_level_current(int i) { return i >= 0 && i < 4 ? rw_level_current[i] : 0; }
EXPORT(rw_w_current_exceeds) double rw_w_current_exceeds(double kA) { return rw_current_exceeds(kA); }
EXPORT(rw_w_striking_distance) double rw_w_striking_distance(double kA) { return rw_striking_distance(kA); }
EXPORT(rw_w_iec_area) double rw_w_iec_area(double L, double W, double H) { return rw_iec_area(L, W, H); }
EXPORT(rw_w_ng) double rw_w_ng(double td) { return rw_ng_from_thunder_days(td); }
EXPORT(rw_w_check) int rw_w_check(int n) { return rw_check_elements(g_el, n); }

static int radius_ok(double r) { return r == r && r >= 10 && r <= 80; }

/* Builds the scene from the first n elements and rolls a sphere of radius R over it. Then
 * rw_w_info() holds: nx, ny, cell, x0, y0, exposed cells, protect cells, exposed m², protect m²,
 * tall walls, top, minx, miny, maxx, maxy. */
EXPORT(rw_w_scene) int rw_w_scene(int n, double radius) {
  g_ready = 0;
  if (!radius_ok(radius)) return -10;
  if (n < 1 || n > RW_MAX_ELEMENTS + RW_MAX_CHOSEN) return -12; /* the page's own limit is 80, plus planned rods */
  const int rc = rw_build(&g_scene, g_el, n, radius, 0.5);
  if (rc != 0) return rc;
  rw_roll(&g_scene, radius, &g_sphere);
  g_info[0] = g_scene.nx;
  g_info[1] = g_scene.ny;
  g_info[2] = g_scene.cell;
  g_info[3] = g_scene.x0;
  g_info[4] = g_scene.y0;
  g_info[5] = g_sphere.exposed_cells;
  g_info[6] = g_sphere.protect_cells;
  g_info[7] = g_sphere.exposed_area;
  g_info[8] = g_sphere.protect_area;
  g_info[9] = g_sphere.tall_walls;
  g_info[10] = g_scene.top;
  g_info[11] = g_scene.minx;
  g_info[12] = g_scene.miny;
  g_info[13] = g_scene.maxx;
  g_info[14] = g_scene.maxy;
  g_ready = 1;
  return 0;
}
EXPORT(rw_w_info) double *rw_w_info(void) { return g_info; }
EXPORT(rw_w_heights) float *rw_w_heights(void) { return g_scene.h; }
EXPORT(rw_w_kinds) uint8_t *rw_w_kinds(void) { return g_scene.kind; }
EXPORT(rw_w_owner) int16_t *rw_w_owner(void) { return g_scene.element; }
EXPORT(rw_w_centre) float *rw_w_centre(void) { return g_sphere.centre; }
EXPORT(rw_w_under) float *rw_w_under(void) { return g_sphere.under; }

/* The electrogeometric model on the current scene. */
EXPORT(rw_w_strikes) int rw_w_strikes(int leaders, uint32_t seed) {
  if (!g_ready) return -1;
  if (leaders < 1000 || leaders > 400000) return -2;
  rw_strikes(&g_scene, leaders, seed, &g_egm);
  return g_egm.shown;
}
EXPORT(rw_w_rates) double *rw_w_rates(void) { return g_egm.rate; }
EXPORT(rw_w_max_failure) double rw_w_max_failure(void) { return g_egm.max_failure_current; }
EXPORT(rw_w_element_rates) double *rw_w_element_rates(void) { return g_egm.element_rate; }
EXPORT(rw_w_density) float *rw_w_density(void) { return g_egm.density; }
EXPORT(rw_w_shown) rw_strike *rw_w_shown(void) { return g_egm.strikes; }
EXPORT(rw_w_strike_size) int rw_w_strike_size(void) { return (int)sizeof(rw_strike); }

/* Plans air terminals for the first n elements. Output: chosen, total cost, exposed before, exposed
 * after, candidates, evaluations, complete, then x, y, length and cost of each rod. */
EXPORT(rw_w_plan) int rw_w_plan(int n, double radius, double l0, double c0, double l1, double c1, double l2, double c2,
                                int nlengths, double spacing) {
  if (!radius_ok(radius)) return -10;
  if (n < 1 || n > RW_MAX_ELEMENTS || rw_check_elements(g_el, n) != 0) return -11;
  rw_plan_options o = {.lengths = {l0, l1, l2, 0}, .costs = {c0, c1, c2, 0}, .nlengths = nlengths, .spacing = spacing};
  static rw_plan p;
  const int rc = rw_plan_terminals(g_el, n, radius, &o, &p);
  g_ready = 0; /* the planner used the shared scratch; build the scene again before reading it */
  if (rc != 0) return rc;
  g_plan_out[0] = p.chosen;
  g_plan_out[1] = p.total_cost;
  g_plan_out[2] = p.exposed_before;
  g_plan_out[3] = p.exposed_after;
  g_plan_out[4] = p.candidates;
  g_plan_out[5] = p.evaluations;
  g_plan_out[6] = p.complete;
  for (int k = 0; k < p.chosen; k++) {
    g_plan_out[7 + 4 * k] = p.x[k];
    g_plan_out[8 + 4 * k] = p.y[k];
    g_plan_out[9 + 4 * k] = p.length[k];
    g_plan_out[10 + 4 * k] = p.cost[k];
  }
  return 0;
}
EXPORT(rw_w_plan_out) double *rw_w_plan_out(void) { return g_plan_out; }
