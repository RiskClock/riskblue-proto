import { expect, test } from "bun:test";
import { toggleControlWithParent } from "./intentionalControlSelection";

function apply(instanceIds: string[], controlIds: string[], instance = "SPSDD002") {
  let instances = [...instanceIds];
  const controls = new Set(controlIds);
  toggleControlWithParent(instance, `${instance}::Below Grade Water Response Plan`, instances, controls,
    (ids, selected) => {
      if (selected) instances = Array.from(new Set([...instances, ...ids]));
    },
    id => { if (controls.has(id)) controls.delete(id); else controls.add(id); },
  );
  return { instances, controls: Array.from(controls) };
}

test("choosing a control selects only its unselected parent instance and that control", () => {
  expect(apply([], [])).toEqual({
    instances: ["SPSDD002"],
    controls: ["SPSDD002::Below Grade Water Response Plan"],
  });
});

test("choosing a control preserves other locations and their chosen controls", () => {
  expect(apply(["SPSDD001"], ["SPSDD001::Presence of Water Monitoring"])).toEqual({
    instances: ["SPSDD001", "SPSDD002"],
    controls: ["SPSDD001::Presence of Water Monitoring", "SPSDD002::Below Grade Water Response Plan"],
  });
});

test("removing the last control leaves its parent instance selected", () => {
  expect(apply(["SPSDD002"], ["SPSDD002::Below Grade Water Response Plan"])).toEqual({
    instances: ["SPSDD002"], controls: [],
  });
});

test("choosing a control on a selected instance does not reselect it", () => {
  const calls: string[] = [];
  toggleControlWithParent("SPSDD002", "SPSDD002::Below Grade Water Response Plan", ["SPSDD002"], new Set(),
    () => calls.push("select instance"), id => calls.push(id));
  expect(calls).toEqual(["SPSDD002::Below Grade Water Response Plan"]);
});