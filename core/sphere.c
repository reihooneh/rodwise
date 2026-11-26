/* The rolling sphere on a height field.
 *
 * A sphere of radius R can sit centred over cell c no lower than
 *     centre(c) = max(R, max over cells s within R of  h(s) + sqrt(R² - |c - s|²)),
 * the grey-scale dilation of the height field by a ball (R itself is the ground). Its underside over a
 * cell p is centre(c) - sqrt(R² - |c - p|²), so the lowest the sphere can reach over p is the
 * closing
 *     under(p) = min over c within R of  centre(c) - sqrt(R² - |c - p|²)  >=  h(p).
 * Where under(p) = h(p) some resting place of the sphere touches p: the sphere, and so lightning, can
 * reach it. Where under(p) > h(p) the sphere passes over: p sits in the protected zone. */
#include "rodwise.h"

const double rw_level_radius[4] = {20, 30, 45, 60};

uint64_t rw_work = 0; /* disk offsets examined: the planner's measure of effort */
const double rw_level_current[4] = {3, 5, 10, 16};

/* The cells of a disk of radius R, nearest first, and the height of the sphere's cap over each. */
#define MAX_RC 120
#define MAX_OFFSETS ((2 * MAX_RC + 1) * (2 * MAX_RC + 1))
static int16_t g_dx[MAX_OFFSETS], g_dy[MAX_OFFSETS];
static float g_cap[MAX_OFFSETS];
static int g_noff = 0;
static double g_for_radius = -1, g_for_cell = -1;

static void offsets(double radius, double cell) {
  if (radius == g_for_radius && cell == g_for_cell) return;
  int rc = (int)(radius / cell);
  if (rc > MAX_RC) rc = MAX_RC;
  const int maxd2 = rc * rc + 2 * rc; /* every cell whose centre is within R */
  static int count[MAX_RC * MAX_RC + 2 * MAX_RC + 2];
  for (int i = 0; i <= maxd2; i++) count[i] = 0;
  const double r2 = radius * radius;
  for (int dy = -rc; dy <= rc; dy++)
    for (int dx = -rc; dx <= rc; dx++) {
      const int d2 = dx * dx + dy * dy;
      if (d2 * cell * cell <= r2) count[d2]++;
    }
  /* Counting sort by distance: start of each distance bucket. */
  int sum = 0;
  for (int i = 0; i <= maxd2; i++) {
    const int c = count[i];
    count[i] = sum;
    sum += c;
  }
  for (int dy = -rc; dy <= rc; dy++)
    for (int dx = -rc; dx <= rc; dx++) {
      const int d2 = dx * dx + dy * dy;
      if (d2 * cell * cell > r2) continue;
      const int at = count[d2]++;
      g_dx[at] = (int16_t)dx;
      g_dy[at] = (int16_t)dy;
      g_cap[at] = (float)rw_sqrt(r2 - d2 * cell * cell);
    }
  g_noff = sum;
  g_for_radius = radius;
  g_for_cell = cell;
}

void rw_dilate(const rw_scene *s, double radius, float *centre) {
  offsets(radius, s->cell);
  const int nx = s->nx, ny = s->ny, n = nx * ny;
  for (int c = 0; c < n; c++) centre[c] = (float)radius;
  for (int j = 0; j < ny; j++)
    for (int i = 0; i < nx; i++) {
      const float h = s->h[j * nx + i];
      if (h <= 0) continue;
      rw_work += (uint64_t)g_noff;
      for (int o = 0; o < g_noff; o++) {
        const int x = i + g_dx[o], y = j + g_dy[o];
        if ((unsigned)x >= (unsigned)nx || (unsigned)y >= (unsigned)ny) continue;
        const float v = h + g_cap[o];
        float *t = &centre[y * nx + x];
        if (v > *t) *t = v;
      }
    }
}

/* Raises the centre heights for one more thing of height `top` standing in cell (i, j). */
void rw_dilate_add(const rw_scene *s, double radius, float *centre, int i, int j, float top) {
  offsets(radius, s->cell);
  rw_work += (uint64_t)g_noff;
  const int nx = s->nx, ny = s->ny;
  for (int o = 0; o < g_noff; o++) {
    const int x = i + g_dx[o], y = j + g_dy[o];
    if ((unsigned)x >= (unsigned)nx || (unsigned)y >= (unsigned)ny) continue;
    const float v = top + g_cap[o];
    float *t = &centre[y * nx + x];
    if (v > *t) *t = v;
  }
}

/* The lowest sphere surface over cell (i, j). Stops early, at the first resting place that
 * touches it, when `stop_on_touch` is set (only whether it is touched is then right). */
float rw_under(const rw_scene *s, const float *centre, int i, int j, int stop_on_touch) {
  const int nx = s->nx, ny = s->ny;
  const float h = s->h[j * nx + i];
  float best = 1e30f;
  for (int o = 0; o < g_noff; o++) {
    const int x = i + g_dx[o], y = j + g_dy[o];
    if ((unsigned)x >= (unsigned)nx || (unsigned)y >= (unsigned)ny) continue;
    const float v = centre[y * nx + x] - g_cap[o];
    if (v < best) {
      best = v;
      if (stop_on_touch && best - h <= (float)RW_TOUCH) {
        rw_work += (uint64_t)o + 1;
        return best;
      }
    }
  }
  rw_work += (uint64_t)g_noff;
  return best;
}

/* The first resting place (an index into the disk's offsets) whose sphere touches cell (i, j), or
 * -1 if none does. */
int rw_touch_at(const rw_scene *s, const float *centre, int i, int j) {
  const int nx = s->nx, ny = s->ny;
  const float h = s->h[j * nx + i];
  for (int o = 0; o < g_noff; o++) {
    const int x = i + g_dx[o], y = j + g_dy[o];
    if ((unsigned)x >= (unsigned)nx || (unsigned)y >= (unsigned)ny) continue;
    if (centre[y * nx + x] - g_cap[o] - h <= (float)RW_TOUCH) {
      rw_work += (uint64_t)o + 1;
      return o;
    }
  }
  rw_work += (uint64_t)g_noff;
  return -1;
}

/* The same as rw_under with stop_on_touch, with one extra rod of height `top` in cell (ri, rj) that
 * isn't in `centre` yet. `hint` is a resting place that touched the cell before the rod (or -1):
 * it is tried first, since it usually still does. */
float rw_under_with(const rw_scene *s, const float *centre, int i, int j, int ri, int rj, float top, int hint) {
  const int nx = s->nx, ny = s->ny;
  const float h = s->h[j * nx + i];
  const double c2 = s->cell * s->cell, r2 = g_for_radius * g_for_radius;
  if (hint >= 0 && hint < g_noff) {
    const int x = i + g_dx[hint], y = j + g_dy[hint];
    if ((unsigned)x < (unsigned)nx && (unsigned)y < (unsigned)ny) {
      float cen = centre[y * nx + x];
      const int ex = x - ri, ey = y - rj;
      const double d2 = (double)(ex * ex + ey * ey) * c2;
      if (d2 <= r2) {
        const float v = top + (float)rw_sqrt(r2 - d2);
        if (v > cen) cen = v;
      }
      if (cen - g_cap[hint] - h <= (float)RW_TOUCH) return cen - g_cap[hint];
    }
  }
  float best = 1e30f;
  for (int o = 0; o < g_noff; o++) {
    const int x = i + g_dx[o], y = j + g_dy[o];
    if ((unsigned)x >= (unsigned)nx || (unsigned)y >= (unsigned)ny) continue;
    float cen = centre[y * nx + x];
    const int ex = x - ri, ey = y - rj;
    const double d2 = (double)(ex * ex + ey * ey) * c2;
    if (d2 <= r2) {
      const float v = top + (float)rw_sqrt(r2 - d2);
      if (v > cen) cen = v;
    }
    const float v = cen - g_cap[o];
    if (v < best) {
      best = v;
      if (best - h <= (float)RW_TOUCH) {
        rw_work += (uint64_t)o + 1;
        return best;
      }
    }
  }
  rw_work += (uint64_t)g_noff;
  return best;
}

void rw_prepare(double radius, double cell) { offsets(radius, cell); }

static int needs_protecting(uint8_t k) { return k == RW_BUILDING || k == RW_FITTING; }

int rw_touched(const rw_scene *s, const rw_sphere *sp, int c) {
  (void)s;
  return sp->under[c] - s->h[c] <= (float)RW_TOUCH;
}

void rw_roll(const rw_scene *s, double radius, rw_sphere *out) {
  out->radius = radius;
  rw_dilate(s, radius, out->centre);
  const int nx = s->nx, ny = s->ny;
  const double area = s->cell * s->cell;
  out->exposed_cells = out->protect_cells = out->tall_walls = 0;
  out->exposed_area = out->protect_area = 0;
  for (int j = 0; j < ny; j++)
    for (int i = 0; i < nx; i++) {
      const int c = j * nx + i;
      if (s->h[c] <= 0) {
        out->under[c] = s->h[c];
        continue;
      }
      out->under[c] = rw_under(s, out->centre, i, j, 0);
      if (!needs_protecting(s->kind[c])) continue;
      out->protect_cells++;
      out->protect_area += area;
      if (out->under[c] - s->h[c] <= (float)RW_TOUCH) {
        out->exposed_cells++;
        out->exposed_area += area;
      }
      /* A wall rising more than R above the ground or roof beside it can take a side flash. */
      static const int nb[4][2] = {{1, 0}, {-1, 0}, {0, 1}, {0, -1}};
      for (int k = 0; k < 4; k++) {
        const int x = i + nb[k][0], y = j + nb[k][1];
        if ((unsigned)x >= (unsigned)nx || (unsigned)y >= (unsigned)ny) continue;
        if ((double)(s->h[c] - s->h[y * nx + x]) > radius) {
          out->tall_walls++;
          break;
        }
      }
    }
}
