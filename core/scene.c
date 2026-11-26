/* Turning a list of building elements into a height field. */
#include "rodwise.h"

static int finite_in(double v, double lo, double hi) { return v == v && v >= lo && v <= hi; }

/* Checks one element's numbers. The C side checks again whatever the page has checked: these are
 * the only numbers that reach the grid. */
static int check_one(const double *f) {
  const double shape = f[0], kind = f[1];
  if (!finite_in(shape, 1, 7) || shape != (double)(int)shape) return -1;
  if (!finite_in(kind, 1, 4) || kind != (double)(int)kind) return -1;
  for (int i = 2; i < RW_FIELDS; i++)
    if (!finite_in(f[i], -1000, 1000)) return -1;
  const double M = RW_MAX_COORD, H = RW_MAX_HEIGHT;
  switch ((int)shape) {
    case RW_BOX:
      return finite_in(f[2], -M, M) && finite_in(f[3], -M, M) && finite_in(f[4], 0.3, 2 * M) &&
                     finite_in(f[5], 0.3, 2 * M) && f[2] + f[4] <= M && f[3] + f[5] <= M && finite_in(f[6], 0.1, H)
                 ? 0
                 : -1;
    case RW_GABLE:
      return finite_in(f[2], -M, M) && finite_in(f[3], -M, M) && finite_in(f[4], 0.5, 2 * M) &&
                     finite_in(f[5], 0.5, 2 * M) && f[2] + f[4] <= M && f[3] + f[5] <= M &&
                     finite_in(f[6], 0.5, H) && finite_in(f[7], f[6], H) && (f[8] == 0 || f[8] == 1)
                 ? 0
                 : -1;
    case RW_HIP:
      return finite_in(f[2], -M, M) && finite_in(f[3], -M, M) && finite_in(f[4], 0.5, 2 * M) &&
                     finite_in(f[5], 0.5, 2 * M) && f[2] + f[4] <= M && f[3] + f[5] <= M &&
                     finite_in(f[6], 0.5, H) && finite_in(f[7], f[6], H)
                 ? 0
                 : -1;
    case RW_CYLINDER:
      return finite_in(f[2], -M, M) && finite_in(f[3], -M, M) && finite_in(f[4], 0.2, 30) && finite_in(f[5], 0.1, H) ? 0 : -1;
    case RW_TREE_SHAPE:
      return finite_in(f[2], -M, M) && finite_in(f[3], -M, M) && finite_in(f[4], 0.5, 20) && finite_in(f[5], 0, H) &&
                     finite_in(f[6], f[5] + 0.5, H)
                 ? 0
                 : -1;
    case RW_POLE:
      return finite_in(f[2], -M, M) && finite_in(f[3], -M, M) && finite_in(f[4], 0.3, H) ? 0 : -1;
    case RW_ROD:
      return finite_in(f[2], -M, M) && finite_in(f[3], -M, M) && finite_in(f[4], 0.2, 10) ? 0 : -1;
    default:
      return -1;
  }
}

int rw_check_elements(const double *el, int n) {
  if (n < 1 || n > RW_MAX_ELEMENTS + RW_MAX_CHOSEN) return 1;
  for (int i = 0; i < n; i++)
    if (check_one(el + (size_t)i * RW_FIELDS) != 0) return i + 1;
  return 0;
}

static double dmin(double a, double b) { return a < b ? a : b; }
static double dmax(double a, double b) { return a > b ? a : b; }

/* The extent of one element (m). */
static void extent(const double *f, double *x0, double *y0, double *x1, double *y1) {
  switch ((int)f[0]) {
    case RW_BOX:
    case RW_GABLE:
    case RW_HIP:
      *x0 = f[2]; *y0 = f[3]; *x1 = f[2] + f[4]; *y1 = f[3] + f[5];
      return;
    case RW_CYLINDER:
    case RW_TREE_SHAPE:
      *x0 = f[2] - f[4]; *y0 = f[3] - f[4]; *x1 = f[2] + f[4]; *y1 = f[3] + f[4];
      return;
    default:
      *x0 = *x1 = f[2]; *y0 = *y1 = f[3];
      return;
  }
}

static double clamp(double v, double lo, double hi) { return v < lo ? lo : v > hi ? hi : v; }

/* The height of element f over the cell centred at (px, py), half a cell `half` each way, or -1 where
 * it isn't. A cell takes the highest point of anything that overlaps it, so nothing thinner than a
 * cell (a parapet, a ridge) can fall between the grid's points. */
static double height_at(const double *f, double px, double py, double half) {
  const double x = f[2], y = f[3];
  const double ax = px - half, bx = px + half, ay = py - half, by = py + half;
  switch ((int)f[0]) {
    case RW_BOX:
    case RW_GABLE:
    case RW_HIP: {
      const double w = f[4], d = f[5];
      if (!(ax < x + w && bx > x && ay < y + d && by > y)) return -1;
      /* The part of the footprint inside this cell. */
      const double lx = dmax(ax, x), hx = dmin(bx, x + w), ly = dmax(ay, y), hy = dmin(by, y + d);
      if ((int)f[0] == RW_BOX) return f[6];
      if ((int)f[0] == RW_GABLE) {
        const int ns = f[8] == 1; /* ridge runs north-south: the roof slopes east and west */
        const double half_span = ns ? w / 2 : d / 2, ridge = ns ? x + w / 2 : y + d / 2;
        const double off = ns ? rw_fabs(clamp(ridge, lx, hx) - ridge) : rw_fabs(clamp(ridge, ly, hy) - ridge);
        return f[6] + (f[7] - f[6]) * dmax(0, 1 - off / half_span);
      }
      const double qx = clamp(x + w / 2, lx, hx), qy = clamp(y + d / 2, ly, hy);
      const double edge = dmin(dmin(qx - x, x + w - qx), dmin(qy - y, y + d - qy));
      const double pitch = (f[7] - f[6]) / (dmin(w, d) / 2);
      return dmin(f[7], f[6] + pitch * edge);
    }
    case RW_CYLINDER:
    case RW_TREE_SHAPE: {
      const double dx = clamp(x, ax, bx) - x, dy = clamp(y, ay, by) - y;
      const double q = (dx * dx + dy * dy) / (f[4] * f[4]);
      if (q >= 1) return -1;
      return (int)f[0] == RW_CYLINDER ? f[5] : f[5] + (f[6] - f[5]) * rw_sqrt(1 - q);
    }
    default: /* poles and rods take exactly one cell, placed in rw_build */
      return -1;
  }
}

int rw_build(rw_scene *s, const double *el, int n, double margin, double min_cell) {
  if (rw_check_elements(el, n) != 0) return -1;
  if (!(margin >= 0 && margin <= 80)) return -2;
  double x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9, top = 0;
  for (int i = 0; i < n; i++) {
    double a, b, c, d;
    extent(el + (size_t)i * RW_FIELDS, &a, &b, &c, &d);
    x0 = dmin(x0, a); y0 = dmin(y0, b); x1 = dmax(x1, c); y1 = dmax(y1, d);
  }
  s->minx = x0; s->miny = y0; s->maxx = x1; s->maxy = y1;
  const double W = x1 - x0 + 2 * margin, D = y1 - y0 + 2 * margin;
  static const double cells[] = {0.5, 1.0, 2.0};
  s->cell = 0;
  for (int k = 0; k < 3; k++) {
    if (cells[k] < min_cell) continue;
    if (W / cells[k] + 1 <= RW_MAX_GRID && D / cells[k] + 1 <= RW_MAX_GRID) {
      s->cell = cells[k];
      break;
    }
  }
  if (s->cell == 0) return -3; /* too big even at 2 m cells */
  s->nx = (int)(W / s->cell) + 1;
  s->ny = (int)(D / s->cell) + 1;
  s->x0 = x0 - margin;
  s->y0 = y0 - margin;
  for (int c = 0; c < s->nx * s->ny; c++) {
    s->h[c] = 0;
    s->kind[c] = RW_GROUND;
    s->element[c] = -1;
  }
  /* Shapes first, then rods on top of whatever they stand on. */
  for (int i = 0; i < n; i++) {
    const double *f = el + (size_t)i * RW_FIELDS;
    if ((int)f[0] == RW_ROD) continue;
    if ((int)f[0] == RW_POLE) {
      /* One cell: the one the point falls in (the same rule as rods, so a rod on a pole lands on it). */
      const int k = (int)((f[2] - s->x0) / s->cell), j = (int)((f[3] - s->y0) / s->cell);
      const int at = j * s->nx + k;
      if (f[4] > (double)s->h[at]) {
        s->h[at] = (float)f[4];
        s->kind[at] = (uint8_t)f[1];
        s->element[at] = (int16_t)i;
      }
      continue;
    }
    double a, b, c, d;
    extent(f, &a, &b, &c, &d);
    int i0 = (int)((a - s->x0) / s->cell) - 1, i1 = (int)((c - s->x0) / s->cell) + 1;
    int j0 = (int)((b - s->y0) / s->cell) - 1, j1 = (int)((d - s->y0) / s->cell) + 1;
    if (i0 < 0) i0 = 0;
    if (j0 < 0) j0 = 0;
    if (i1 > s->nx - 1) i1 = s->nx - 1;
    if (j1 > s->ny - 1) j1 = s->ny - 1;
    const uint8_t kind = (uint8_t)f[1];
    for (int j = j0; j <= j1; j++) {
      for (int k = i0; k <= i1; k++) {
        const double px = s->x0 + (k + 0.5) * s->cell, py = s->y0 + (j + 0.5) * s->cell;
        const double hz = height_at(f, px, py, s->cell / 2);
        const int at = j * s->nx + k;
        if (hz > (double)s->h[at]) {
          s->h[at] = (float)hz;
          s->kind[at] = kind;
          s->element[at] = (int16_t)i;
        }
      }
    }
  }
  for (int i = 0; i < n; i++) {
    const double *f = el + (size_t)i * RW_FIELDS;
    if ((int)f[0] != RW_ROD) continue;
    const int k = (int)((f[2] - s->x0) / s->cell), j = (int)((f[3] - s->y0) / s->cell);
    if (k < 0 || j < 0 || k >= s->nx || j >= s->ny) continue;
    const int c = j * s->nx + k;
    s->h[c] = (float)((double)s->h[c] + f[4]);
    s->kind[c] = RW_TERMINAL;
    s->element[c] = (int16_t)i;
  }
  top = 0;
  for (int c = 0; c < s->nx * s->ny; c++) top = dmax(top, (double)s->h[c]);
  s->top = top;
  return 0;
}
