/* The electrogeometric model: many lightning leaders, each striking the first thing within its
 * striking distance. */
#include "rodwise.h"

double rw_current_exceeds(double kA) {
  if (!(kA > 0)) return 1;
  return 1 - rw_ncdf((rw_log(kA) - rw_log(RW_I_MEDIAN)) / RW_I_SIGMA);
}

double rw_striking_distance(double kA) { return kA > 0 ? 10 * rw_exp(0.65 * rw_log(kA)) : 0; }

double rw_iec_area(double L, double W, double H) { return L * W + 6 * H * (L + W) + 9 * PI * H * H; }

double rw_ng_from_thunder_days(double td) { return td > 0 ? 0.012 * rw_exp(1.4 * rw_log(td)) : 0; }

/* Cells grouped in tiles, with each tile's tallest cell, so a leader can skip whole tiles that
 * can't beat what it has already found. */
#define TILE 8
#define MAX_TILES ((RW_MAX_GRID / TILE + 1) * (RW_MAX_GRID / TILE + 1))
static float g_tile_top[MAX_TILES];

void rw_strikes(const rw_scene *s, int leaders, uint32_t seed, rw_egm *out) {
  const int nx = s->nx, ny = s->ny, n = nx * ny;
  const int tx = (nx + TILE - 1) / TILE, ty = (ny + TILE - 1) / TILE;
  for (int t = 0; t < tx * ty; t++) g_tile_top[t] = 0;
  for (int c = 0; c < n; c++) {
    out->density[c] = 0;
    const int t = (c / nx / TILE) * tx + (c % nx) / TILE;
    if (s->h[c] > g_tile_top[t]) g_tile_top[t] = s->h[c];
  }
  for (int k = 0; k < 5; k++) out->rate[k] = 0;
  for (int e = 0; e < RW_MAX_ELEMENTS + RW_MAX_CHOSEN; e++) out->element_rate[e] = 0;
  out->leaders = leaders;
  out->weight_total = 0;
  out->shown = 0;
  out->small_failures = 0;
  out->max_failure_current = 0;

  rw_rng r;
  rw_seed(&r, seed, 1768u);
  const double cell = s->cell;
  const double W = s->maxx - s->minx, D = s->maxy - s->miny;
  for (int l = 0; l < leaders; l++) {
    double I = RW_I_MEDIAN * rw_exp(RW_I_SIGMA * rw_normal(&r));
    if (I < 2) I = 2;
    if (I > 400) I = 400;
    const double R = rw_striking_distance(I), R2 = R * R;
    /* Anywhere this leader could reach the scene from, uniformly; weighted by that area. */
    const double area = (W + 2 * R) * (D + 2 * R);
    const double px = s->minx - R + rw_uniform(&r) * (W + 2 * R);
    const double py = s->miny - R + rw_uniform(&r) * (D + 2 * R);
    out->weight_total += area;
    /* The tip comes down; the ground is reached when the tip is R above it. Anything taller that
     * comes within R first takes the strike: the cell with the greatest h + sqrt(R² - d²). */
    double best = R;
    int hit = -1;
    for (int t = 0; t < tx * ty; t++) {
      const float top = g_tile_top[t];
      if (top <= 0) continue;
      const int ti = t % tx, tj = t / tx;
      const double ax = s->x0 + ti * TILE * cell, ay = s->y0 + tj * TILE * cell;
      const double bx = ax + TILE * cell, by = ay + TILE * cell;
      const double qx = px < ax ? ax - px : px > bx ? px - bx : 0;
      const double qy = py < ay ? ay - py : py > by ? py - by : 0;
      const double q2 = qx * qx + qy * qy;
      if (q2 >= R2 || (double)top + rw_sqrt(R2 - q2) <= best) continue;
      const int i1 = ti * TILE + TILE < nx ? ti * TILE + TILE : nx;
      const int j1 = tj * TILE + TILE < ny ? tj * TILE + TILE : ny;
      for (int j = tj * TILE; j < j1; j++)
        for (int i = ti * TILE; i < i1; i++) {
          const int c = j * nx + i;
          const float h = s->h[c];
          if (h <= 0) continue;
          const double dx = s->x0 + (i + 0.5) * cell - px, dy = s->y0 + (j + 0.5) * cell - py;
          const double d2 = dx * dx + dy * dy;
          if (d2 >= R2) continue;
          const double v = (double)h + rw_sqrt(R2 - d2);
          if (v > best) {
            best = v;
            hit = c;
          }
        }
    }
    const int kind = hit >= 0 ? s->kind[hit] : RW_GROUND;
    out->rate[kind] += area;
    if (hit >= 0) {
      out->density[hit] += (float)area;
      if (s->element[hit] >= 0) out->element_rate[s->element[hit]] += area;
      if (kind == RW_BUILDING || kind == RW_FITTING) {
        out->small_failures += area;
        if (I > out->max_failure_current) out->max_failure_current = I;
      }
    }
    /* Keep strikes near the scene for the animation. */
    const int near = px > s->minx - 6 && px < s->maxx + 6 && py > s->miny - 6 && py < s->maxy + 6;
    if (out->shown < RW_MAX_SHOWN && (hit >= 0 || near)) {
      rw_strike *k = &out->strikes[out->shown++];
      k->current = (float)I;
      k->kind = (int16_t)kind;
      if (hit >= 0) {
        k->x = (float)(s->x0 + (hit % nx + 0.5) * cell);
        const int row = hit / nx;
        k->y = (float)(s->y0 + (row + 0.5) * cell);
        k->z = s->h[hit];
        k->element = s->element[hit];
      } else {
        k->x = (float)px;
        k->y = (float)py;
        k->z = 0;
        k->element = -1;
      }
    }
  }
  /* Per leader, and from m² to km²: strikes a year for one ground flash per km² per year. */
  const double scale = leaders > 0 ? 1e-6 / leaders : 0;
  for (int k = 0; k < 5; k++) out->rate[k] *= scale;
  for (int e = 0; e < RW_MAX_ELEMENTS + RW_MAX_CHOSEN; e++) out->element_rate[e] *= scale;
  for (int c = 0; c < n; c++) out->density[c] = (float)((double)out->density[c] * scale);
  out->small_failures *= scale;
}
