import { describe, expect, it } from "vitest";
import { physicsRoutes } from "./physicsRoutes";

const setting = (inputs: [string, number, string, boolean?][], outputs: string[]) => ({
  Input: inputs.map(([Id, Weight, Type, Reflect]) => ({ Source: { Id }, Weight, Type, Reflect })),
  Output: outputs.map((Id) => ({ Destination: { Id } })),
});

describe("physicsRoutes", () => {
  it("routes physics-smoothed outputs to the input that drives them", () => {
    const routes = physicsRoutes({
      PhysicsSettings: [
        setting([["AngleX", 100, "Angle"]], ["ParamAngleX"]),
        setting([["PositionZ", 70, "Angle", true], ["PositionX", 10, "X"]], ["ParamBodyAngleZ"]),
        // Arms: no single dominant angle input, so they are left to physics.
        setting([["PositionY", 48, "X"], ["ParamBreath", 5, "Angle"], ["ParamBodyAngleX", 52, "X"]], ["LArm"]),
        // Hair driven by the head: its input is itself a physics output.
        setting([["ParamAngleX", 100, "Angle"]], ["HairFront"]),
      ],
    });
    expect(Object.fromEntries(routes)).toEqual({
      ParamAngleX: { id: "AngleX", scale: 1 },
      ParamBodyAngleZ: { id: "PositionZ", scale: -1 },
    });
  });

  it("is empty for plain rigs and bad input", () => {
    expect(physicsRoutes({ PhysicsSettings: [setting([["ParamAngleX", 100, "Angle"]], ["HairFront"])] }).size).toBe(1);
    expect(physicsRoutes(null).size).toBe(0);
    expect(physicsRoutes({}).size).toBe(0);
  });
});
