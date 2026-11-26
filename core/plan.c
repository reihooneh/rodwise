/* Choosing air terminals.
 *
 * Adding a rod only ever raises the sphere (it is one more thing to roll over), so a cell it
 * protects stays protected whatever else is added. That makes the greedy pass cheap: each round only
 * re-checks the cells that are still exposed. The search runs on a 1 m grid; the plan is then
 * checked on the fine grid, and topped up there if a sliver is still exposed. */
#include "rodwise.h"

static int protects(uint8_t k) { return k == RW_BUILDING || k == RW_FITTING; }

static float g_centre[RW_MAX_CELLS];
static float g_base[RW_MAX_CELLS];
static int g_exposed[RW_MAX_CELLS];
static int g_hint[RW_MAX_CELLS]; /* for each exposed cell, a resting place that touches it */
static int g_cand[RW_MAX_CANDIDATES];
static int g_stopped = 0; /* the work limit was reached */

typedef struct {
  int cell[RW_MAX_CHOSEN];
  float base[RW_MAX_CHOSEN];
  int len[RW_MAX_CHOSEN];
  uint8_t kind[RW_MAX_CHOSEN]; /* what the rod stands on */
  int n;
} chosen;

/* Cells of building and fittings the sphere still touches. */
static int list_exposed(const rw_scene *s, const float *centre, int *list) {
  int n = 0;
  for (int c = 0; c < s->nx * s->ny; c++) {
    if (!protects(s->kind[c])) continue;
    const float u = rw_under(s, centre, c % s->nx, c / s->nx, 1);
    if (u - s->h[c] <= (float)RW_TOUCH) list[n++] = c;
  }
  return n;
}

/* Places on the roof worth trying: a lattice, the ridges and peaks, every fitting, and (room
 * allowing) every cell still exposed, so a corner or edge the lattice misses can have its own rod. */
static int candidates(const rw_scene *s, double spacing, int *cand, const int *exposed, int nexp) {
  int step = (int)(spacing / s->cell + 0.5);
  if (step < 1) step = 1;
  for (;;) {
    int n = 0, overflow = 0;
    for (int j = 1; j < s->ny - 1 && !overflow; j++)
      for (int i = 1; i < s->nx - 1; i++) {
        const int c = j * s->nx + i;
        if (!protects(s->kind[c])) continue;
        const float h = s->h[c];
        int peak = 1;
        for (int dj = -1; dj <= 1 && peak; dj++)
          for (int di = -1; di <= 1; di++)
            if (s->h[c + dj * s->nx + di] > h + 0.01f) peak = 0;
        const int lattice = i % step == 0 && j % step == 0;
        const int ridge = peak && (i + j) % step == 0;
        if (lattice || ridge || s->kind[c] == RW_FITTING) {
          if (n == RW_MAX_CANDIDATES) {
            overflow = 1;
            break;
          }
          cand[n++] = c;
        }
      }
    if (!overflow) {
      for (int e = 0; e < nexp && n < RW_MAX_CANDIDATES; e++) {
        int seen = 0;
        for (int k = 0; k < n && !seen; k++) seen = cand[k] == exposed[e];
        if (!seen) cand[n++] = exposed[e];
      }
      return n;
    }
    step++;
  }
}

/* Greedy: add the terminal that protects the most exposed cells per dollar, until none are left
 * or nothing helps. Updates the scene (rods become part of it), centre and the exposed list. */
static void greedy(rw_scene *s, double radius, const rw_plan_options *opt, const int *cand, int ncand, chosen *ch,
                   int *nexp, int *evals) {
  while (*nexp > 0 && ch->n < RW_MAX_CHOSEN) {
    if (rw_work > RW_WORK_LIMIT) {
      g_stopped = 1;
      return;
    }
    for (int e = 0; e < *nexp; e++) g_hint[e] = rw_touch_at(s, g_centre, g_exposed[e] % s->nx, g_exposed[e] / s->nx);
    double best_score = 0;
    int best_c = -1, best_l = -1, best_gain = 0;
    for (int k = 0; k < ncand; k++) {
      if (rw_work > RW_WORK_LIMIT) {
        g_stopped = 1;
        return; /* mid-round: keep what is placed, add nothing half-weighed */
      }
      const int c = cand[k];
      if (s->kind[c] == RW_TERMINAL) continue;
      const int ri = c % s->nx, rj = c / s->nx;
      for (int l = 0; l < opt->nlengths; l++) {
        /* Even protecting every exposed cell couldn't beat the best so far. */
        if ((double)*nexp / opt->costs[l] <= best_score) continue;
        const float top = s->h[c] + (float)opt->lengths[l];
        /* Stop counting as soon as this rod can no longer beat the best so far. */
        const double need = best_score * opt->costs[l];
        int gain = 0;
        for (int e = 0; e < *nexp; e++) {
          if (gain + (*nexp - e) <= need) break;
          const int p = g_exposed[e];
          if (p == c) {
            gain++;
            continue;
          }
          const float u = rw_under_with(s, g_centre, p % s->nx, p / s->nx, ri, rj, top, g_hint[e]);
          if (u - s->h[p] > (float)RW_TOUCH) gain++;
        }
        (*evals)++;
        const double score = gain / opt->costs[l];
        if (gain > 0 && score > best_score) {
          best_score = score;
          best_c = c;
          best_l = l;
          best_gain = gain;
        }
      }
    }
    if (best_c < 0 || best_gain == 0) return;
    ch->cell[ch->n] = best_c;
    ch->base[ch->n] = s->h[best_c];
    ch->len[ch->n] = best_l;
    ch->kind[ch->n] = s->kind[best_c];
    ch->n++;
    const float top = s->h[best_c] + (float)opt->lengths[best_l];
    rw_dilate_add(s, radius, g_centre, best_c % s->nx, best_c / s->nx, top);
    s->h[best_c] = top;
    s->kind[best_c] = RW_TERMINAL;
    int m = 0;
    for (int e = 0; e < *nexp; e++) {
      const int p = g_exposed[e];
      if (!protects(s->kind[p])) continue;
      const float u = rw_under(s, g_centre, p % s->nx, p / s->nx, 1);
      if (u - s->h[p] <= (float)RW_TOUCH) g_exposed[m++] = p;
    }
    *nexp = m;
  }
}

/* Puts every chosen rod into the scene at its length (or takes rod `skip` out). Returns the number
 * of exposed cells with that set. */
static int try_set(rw_scene *s, double radius, const rw_plan_options *opt, const chosen *ch, const uint8_t *kinds,
                   int skip, int len_override) {
  for (int k = 0; k < ch->n; k++) {
    const int c = ch->cell[k];
    if (k == skip && len_override < 0) {
      s->h[c] = ch->base[k];
      s->kind[c] = kinds[k];
    } else {
      const int l = k == skip ? len_override : ch->len[k];
      s->h[c] = ch->base[k] + (float)opt->lengths[l];
      s->kind[c] = RW_TERMINAL;
    }
  }
  rw_dilate(s, radius, g_centre);
  return list_exposed(s, g_centre, g_exposed);
}

static int check_options(const rw_plan_options *o) {
  if (o->nlengths < 1 || o->nlengths > 4) return -1;
  for (int l = 0; l < o->nlengths; l++) {
    if (!(o->lengths[l] >= 0.2 && o->lengths[l] <= 10)) return -1;
    if (!(o->costs[l] >= 1 && o->costs[l] <= 1e6)) return -1;
    if (l > 0 && !(o->lengths[l] > o->lengths[l - 1])) return -1;
  }
  return o->spacing >= 0.5 && o->spacing <= 20 ? 0 : -1;
}

static rw_scene g_coarse, g_fine;

/* A rod on an antenna or flagpole goes on the pole itself, wherever the grid put its cell. */
static void record(const rw_scene *s, const double *el, const rw_plan_options *opt, const chosen *ch, rw_plan *out) {
  for (int k = 0; k < ch->n && out->chosen < RW_MAX_CHOSEN; k++) {
    const int c = ch->cell[k], m = out->chosen++;
    const int e = s->element[c];
    if (e >= 0 && (int)el[(size_t)e * RW_FIELDS] == RW_POLE) {
      out->x[m] = el[(size_t)e * RW_FIELDS + 2];
      out->y[m] = el[(size_t)e * RW_FIELDS + 3];
    } else {
      out->x[m] = s->x0 + (c % s->nx + 0.5) * s->cell;
      const int row = c / s->nx;
      out->y[m] = s->y0 + (row + 0.5) * s->cell;
    }
    out->length[m] = opt->lengths[ch->len[k]];
    out->cost[m] = opt->costs[ch->len[k]];
    out->total_cost += out->cost[m];
  }
}

/* el must have room for n + RW_MAX_CHOSEN elements: the plan's rods are appended to check it. */
int rw_plan_terminals(double *el, int n, double radius, const rw_plan_options *opt, rw_plan *out) {
  if (check_options(opt) != 0) return -1;
  if (!(radius >= 10 && radius <= 80)) return -2;
  if (rw_build(&g_coarse, el, n, radius, 1.0) != 0) return -3;
  out->chosen = 0;
  out->total_cost = 0;
  out->evaluations = 0;
  rw_work = 0;
  g_stopped = 0;
  rw_scene *s = &g_coarse;
  rw_prepare(radius, s->cell);
  rw_dilate(s, radius, g_centre);
  int nexp = list_exposed(s, g_centre, g_exposed);
  const int ncand = candidates(s, opt->spacing, g_cand, g_exposed, 0);
  out->candidates = ncand;
  chosen ch = {.n = 0};
  greedy(s, radius, opt, g_cand, ncand, &ch, &nexp, &out->evaluations);

  /* Drop terminals the others make unnecessary, and shorten what can be shortened. */
  uint8_t kinds[RW_MAX_CHOSEN];
  for (int k = 0; k < ch.n; k++) kinds[k] = ch.kind[k];
  const int target = try_set(s, radius, opt, &ch, kinds, -1, 0);
  for (int k = ch.n - 1; k >= 0 && rw_work < RW_WORK_LIMIT + RW_WORK_LIMIT / 2; k--) {
    if (try_set(s, radius, opt, &ch, kinds, k, -1) <= target) {
      for (int m = k; m < ch.n - 1; m++) {
        ch.cell[m] = ch.cell[m + 1];
        ch.base[m] = ch.base[m + 1];
        ch.len[m] = ch.len[m + 1];
        kinds[m] = kinds[m + 1];
        ch.kind[m] = ch.kind[m + 1];
      }
      ch.n--;
      /* The removed rod's cell goes back to roof. */
      (void)try_set(s, radius, opt, &ch, kinds, -1, 0);
    }
  }
  for (int k = 0; k < ch.n && rw_work < RW_WORK_LIMIT + RW_WORK_LIMIT / 2; k++)
    for (int l = 0; l < ch.len[k]; l++)
      if (try_set(s, radius, opt, &ch, kinds, k, l) <= target) {
        ch.len[k] = l;
        break;
      }
  record(s, el, opt, &ch, out);

  /* Check on the fine grid, with the rods as elements, and top up any sliver still exposed. */
  int m = n;
  for (int k = 0; k < out->chosen; k++, m++) {
    double *f = el + (size_t)m * RW_FIELDS;
    f[0] = RW_ROD; f[1] = RW_TERMINAL; f[2] = out->x[k]; f[3] = out->y[k]; f[4] = out->length[k];
    f[5] = f[6] = f[7] = f[8] = 0;
  }
  if (rw_build(&g_fine, el, m, radius, 0.5) != 0) return -4;
  (void)rw_build(&g_coarse, el, n, radius, 0.5); /* the bare building, for the before count */
  rw_prepare(radius, g_coarse.cell);
  rw_dilate(&g_coarse, radius, g_centre);
  out->exposed_before = list_exposed(&g_coarse, g_centre, g_exposed);
  s = &g_fine;
  rw_prepare(radius, s->cell);
  rw_dilate(s, radius, g_centre);
  nexp = list_exposed(s, g_centre, g_exposed);
  const int topped = nexp > 0;
  if (nexp > 0) {
    /* Only the cells still exposed are worth a rod now (thinned to at most 120 of them). */
    int nc = 0;
    const int stride = nexp > 120 ? (nexp + 119) / 120 : 1;
    for (int e = 0; e < nexp; e += stride) g_cand[nc++] = g_exposed[e];
    chosen more = {.n = 0};
    greedy(s, radius, opt, g_cand, nc, &more, &nexp, &out->evaluations);
    record(s, el, opt, &more, out);
  }
  out->exposed_after = nexp;
  out->complete = !g_stopped;
  if (!topped) return 0;

  /* The top-up can make an earlier rod redundant: try taking each out, on the fine grid. Taking a
   * rod out only changes the sphere through that rod's cap, so each try starts from the bare
   * building's dilation (g_coarse holds the bare building on the fine grid) plus the other rods. */
  const int residual = out->exposed_after;
  static int cell[RW_MAX_CHOSEN];
  rw_dilate(&g_coarse, radius, g_base);
  for (int k = 0; k < out->chosen; k++) {
    const int i = (int)((out->x[k] - g_fine.x0) / g_fine.cell), j = (int)((out->y[k] - g_fine.y0) / g_fine.cell);
    cell[k] = j * g_fine.nx + i;
  }
  const int ncells = g_fine.nx * g_fine.ny;
  for (int k = out->chosen - 1; k >= 0 && rw_work < RW_WORK_LIMIT + RW_WORK_LIMIT / 2; k--) {
    for (int c = 0; c < ncells; c++) g_centre[c] = g_base[c];
    for (int q = 0; q < out->chosen; q++) {
      if (q == k) continue;
      const int c = cell[q];
      rw_dilate_add(&g_fine, radius, g_centre, c % g_fine.nx, c / g_fine.nx, g_coarse.h[c] + (float)out->length[q]);
    }
    const int c = cell[k];
    const float h = g_fine.h[c];
    const uint8_t kind = g_fine.kind[c];
    g_fine.h[c] = g_coarse.h[c];
    g_fine.kind[c] = g_coarse.kind[c];
    if (list_exposed(&g_fine, g_centre, g_exposed) <= residual) {
      out->total_cost -= out->cost[k];
      for (int q = k; q < out->chosen - 1; q++) {
        out->x[q] = out->x[q + 1]; out->y[q] = out->y[q + 1];
        out->length[q] = out->length[q + 1]; out->cost[q] = out->cost[q + 1];
        cell[q] = cell[q + 1];
      }
      out->chosen--;
    } else {
      g_fine.h[c] = h;
      g_fine.kind[c] = kind;
    }
  }
  return 0;
}
