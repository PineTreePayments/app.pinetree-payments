"use client"

import {
  DashboardSection,
  PineTreeInsightsCard
} from "@/components/dashboard/DashboardPrimitives"

export default function RoutingPage() {
  return (
    <div className="space-y-5 md:space-y-7">

      <div>
        <h1 className="text-2xl font-semibold text-gray-950 md:text-3xl">
          Routing
        </h1>
      </div>

      <DashboardSection title="Routing Controls" eyebrow="Engine">
        <div className="rounded-2xl border border-gray-200 bg-white p-4 text-sm leading-6 text-gray-700 shadow-[0_10px_30px_rgba(15,23,42,0.05)] sm:p-5">
          Configure smart routing here.
        </div>
      </DashboardSection>

      <PineTreeInsightsCard
        insights={[]}
        emptyText="Routing insights will appear when provider routing data is available."
      />

    </div>
  )
}
