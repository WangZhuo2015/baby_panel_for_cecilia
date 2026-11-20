import assert from "node:assert/strict";
import test from "node:test";
import { GET } from "../../app/api/weather/route";

test("Open-Meteo air quality is optional in the weather response", async (t) => {
  const previousGrowDesk = process.env.GROWDESK_ENABLED;
  process.env.GROWDESK_ENABLED = "false";
  t.after(() => {
    if (previousGrowDesk === undefined) delete process.env.GROWDESK_ENABLED;
    else process.env.GROWDESK_ENABLED = previousGrowDesk;
  });

  const cases = [
    { name: "HTTP error", response: () => new Response(null, { status: 503 }), expected: "暂无数据" },
    { name: "network error", response: () => { throw new TypeError("Synthetic network failure"); }, expected: "暂无数据" },
    { name: "invalid JSON", response: () => new Response("{"), expected: "暂无数据" },
    { name: "missing field", response: () => Response.json({ current: {} }), expected: "暂无数据" },
    { name: "null body", response: () => Response.json(null), expected: "暂无数据" },
    { name: "invalid AQI", response: () => Response.json({ current: { european_aqi: "20" } }), expected: "暂无数据" },
    { name: "valid AQI", response: () => Response.json({ current: { european_aqi: 76 } }), expected: "良" },
    { name: "zero AQI", response: () => Response.json({ current: { european_aqi: 0 } }), expected: "优" },
  ];

  for (const { name, response: airResponse, expected } of cases) {
    await t.test(name, async (caseTest) => {
      caseTest.mock.method(globalThis, "fetch", async (input: string) => {
        const { hostname } = new URL(input);
        if (hostname === "air-quality-api.open-meteo.com") return airResponse();
        assert.equal(hostname, "api.open-meteo.com");
        return Response.json({
          current: { temperature_2m: 23.6, relative_humidity_2m: 64, weather_code: 0 },
          daily: { uv_index_max: [4.3], precipitation_probability_max: [20] },
          hourly: { time: [], temperature_2m: [], weather_code: [] },
        });
      });

      const response = await GET(new Request("https://test.invalid/api/weather"));
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), {
        city: "苏州",
        temperature: 24,
        condition: "晴",
        uv: 4,
        rainProbability: 20,
        humidity: 64,
        airQuality: expected,
        outdoorAdvice: "适合外出活动",
        hourlyForecast: [],
      });
    });
  }
});
