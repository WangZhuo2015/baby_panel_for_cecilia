import assert from "node:assert/strict";
import test from "node:test";
import {
  activeVaccineIds,
  buildExclusiveVaccineGroups,
  chooseActiveVaccineId,
} from "./vaccine-schedule";

test("Vaccine schedule: data-driven exclusive product groups", () => {
  const entries = [
    { vaccineId: "vac_pcv_a", selectionGroup: "pcv13_product_choice" },
    { vaccineId: "vac_pcv_b", selectionGroup: "pcv13_product_choice" },
    { vaccineId: "vac_rotavirus_a", selectionGroup: "rotavirus_choice" },
    { vaccineId: "vac_rotavirus_b", selectionGroup: "rotavirus_choice" },
    { vaccineId: "vac_pentaxim", selectionGroup: "pertussis_hib_strategy" },
    { vaccineId: "vac_dtap_hib", selectionGroup: "pertussis_hib_strategy" },
    { vaccineId: "vac_hib", selectionGroup: "hib_strategy" },
  ];

  const strategyGroups = [
    {
      optionsJson: [
        { group: "pcv13_product_choice", options: ["vac_pcv_a", "vac_pcv_b"] },
        { group: "rotavirus_choice", options: ["vac_rotavirus_a", "vac_rotavirus_b"] },
        { group: "hib_strategy", options: ["vac_hib"] },
      ],
    },
  ];
  const engineRules = [
    {
      type: "mutually_exclusive_product_series",
      vaccineIdsJson: ["vac_rotavirus_a", "vac_rotavirus_b"],
    },
  ];
  const metadata = [
    { vaccineId: "vac_pentaxim", name: "五联（Hib）", substitutionRules: ["含Hib成分"] },
    { vaccineId: "vac_dtap_hib", name: "四联Hib", substitutionRules: ["不应叠加单独Hib"] },
    { vaccineId: "vac_hib", name: "单独 Hib", substitutionRules: [] },
  ];

  const groups = buildExclusiveVaccineGroups(entries, strategyGroups, engineRules, metadata);
  assert.ok(groups.some((group) => group.includes("vac_pcv_a") && group.includes("vac_pcv_b")));
  assert.ok(groups.some((group) => group.includes("vac_rotavirus_a") && group.includes("vac_rotavirus_b")));

  const pertussisHib = groups.find((group) => group.includes("vac_pentaxim"));
  assert.deepEqual(new Set(pertussisHib), new Set(["vac_pentaxim", "vac_dtap_hib", "vac_hib"]));

  assert.equal(chooseActiveVaccineId(pertussisHib!, {}), "vac_pentaxim");
  assert.equal(
    chooseActiveVaccineId(pertussisHib!, { "vac_dtap_hib-1": { selected: true } }),
    "vac_dtap_hib",
  );
  assert.deepEqual(
    activeVaccineIds(groups, { "vac_pcv_b-1": { completed: true } }),
    new Set(["vac_pcv_b", "vac_rotavirus_a", "vac_pentaxim"]),
  );
});

test("Vaccine schedule: unrelated optional groups stay independent", () => {
  const groups = buildExclusiveVaccineGroups([
    { vaccineId: "vac_ev71", selectionGroup: null },
    { vaccineId: "vac_flu", selectionGroup: null },
  ]);
  assert.deepEqual(groups, []);
});
