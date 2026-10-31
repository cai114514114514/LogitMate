// Physics-aware parameter routing.
//
// Many rigs made for VTube Studio smooth the head and body through physics: tracking writes
// "input" parameters (AngleX, PositionX, ...) and physics produces ParamAngleX, ParamBodyAngleX,
// arms and hair from them. Writing ParamAngleX directly on such a rig is overwritten by physics in
// the same frame, so gaze, breathing and drag sway never show. Routing each standard parameter to
// the input that drives it makes procedural motion work on both kinds of rig, and the arms and
// hair follow as they do under face tracking.

export interface Route {
  id: string;
  /** -1 when physics reflects (inverts) the input. */
  scale: number;
}

interface PhysicsJson {
  PhysicsSettings?: {
    Input?: { Source?: { Id?: string }; Weight?: number; Type?: string; Reflect?: boolean }[];
    Output?: { Destination?: { Id?: string } }[];
  }[];
}

/** Share of a setting's input weight an input needs to stand for the whole output. */
const DOMINANT = 0.5;

/** output parameter -> the input to write instead, for outputs driven by one dominant angle input. */
export function physicsRoutes(physics: unknown): Map<string, Route> {
  const routes = new Map<string, Route>();
  const settings = (physics as PhysicsJson | null)?.PhysicsSettings ?? [];
  const outputs = new Set(settings.flatMap((s) => (s.Output ?? []).map((o) => o.Destination?.Id)).filter(Boolean));
  for (const s of settings) {
    const inputs = (s.Input ?? []).filter((i) => i.Source?.Id && i.Type === "Angle");
    const total = (s.Input ?? []).reduce((sum, i) => sum + (i.Weight ?? 0), 0);
    const top = inputs.sort((a, b) => (b.Weight ?? 0) - (a.Weight ?? 0))[0];
    if (!top || total <= 0 || (top.Weight ?? 0) / total < DOMINANT) continue;
    const input = top.Source!.Id!;
    // An input that is itself computed by physics would be overwritten too.
    if (outputs.has(input)) continue;
    for (const o of s.Output ?? []) {
      const id = o.Destination?.Id;
      if (id && id !== input && !routes.has(id)) routes.set(id, { id: input, scale: top.Reflect ? -1 : 1 });
    }
  }
  return routes;
}
