import { executeShift4FixtureCase } from "./fixture-engine.mjs"
export async function handleShift4FixtureApiRequest(request, dependencies) {
  if (!request || request.mode !== "fixture" || !request.testCase) throw new Error("Invalid fixture API request")
  return executeShift4FixtureCase({ testCase: request.testCase, ...dependencies })
}
