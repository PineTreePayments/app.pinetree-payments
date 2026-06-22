"use client"

import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts"

export type TransactionVolumeSeries = {
  key: string
  label: string
  color: string
}

type ChartDatum = Record<string, string | number>

type Props = {
  data: ChartDatum[]
  xKey: string
  series: TransactionVolumeSeries[]
  className?: string
  emptyTitle?: string
  emptyDescription?: string
  gradientId?: string
}

function formatUsd(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2
  }).format(Number.isFinite(value) ? value : 0)
}

export function hasTransactionVolume(data: ChartDatum[], series: TransactionVolumeSeries[]) {
  return data.some((row) => series.some((item) => Number(row[item.key] || 0) > 0))
}

export function prepareTransactionVolumeData(data: ChartDatum[], xKey: string) {
  return data.length === 1
    ? [data[0], { ...data[0], [xKey]: `${String(data[0][xKey] || "")} ` }]
    : data
}

export default function TransactionVolumeChart({
  data,
  xKey,
  series,
  className = "h-72",
  emptyTitle = "No payment volume yet",
  emptyDescription = "Transactions will appear here once payments are confirmed.",
  gradientId = "transactionVolume"
}: Props) {
  const hasVolume = hasTransactionVolume(data, series)
  const displayData = prepareTransactionVolumeData(data, xKey)

  if (!hasVolume) {
    return (
      <div className={`flex flex-col items-center justify-center rounded-2xl border border-dashed border-blue-100 bg-blue-50/40 px-4 text-center ${className}`}>
        <p className="text-sm font-semibold text-gray-950">{emptyTitle}</p>
        <p className="mt-1 max-w-sm text-xs leading-5 text-gray-500">{emptyDescription}</p>
      </div>
    )
  }

  return (
    <div className={className}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={displayData} margin={{ top: 8, right: 8, left: -12, bottom: 16 }}>
          <defs>
            {series.map((item) => (
              <linearGradient key={item.key} id={`${gradientId}-${item.key}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={item.color} stopOpacity={0.24} />
                <stop offset="100%" stopColor={item.color} stopOpacity={0.02} />
              </linearGradient>
            ))}
          </defs>
          <CartesianGrid stroke="#f1f5f9" strokeDasharray="2 8" vertical={false} />
          <XAxis
            dataKey={xKey}
            axisLine={false}
            tickLine={false}
            tick={{ fill: "#64748b", fontSize: 9 }}
            interval="preserveStartEnd"
            minTickGap={36}
            dy={8}
          />
          <YAxis
            axisLine={false}
            tickLine={false}
            width={52}
            tick={{ fill: "#64748b", fontSize: 9 }}
            tickFormatter={(value) => formatUsd(Number(value))}
          />
          <Tooltip
            formatter={(value, name) => [formatUsd(Number(value)), String(name)]}
            contentStyle={{
              background: "#fff",
              border: "1px solid #dbeafe",
              borderRadius: "12px",
              boxShadow: "0 18px 50px rgba(15,23,42,0.12)",
              fontSize: "12px"
            }}
          />
          {series.length > 1 ? <Legend wrapperStyle={{ fontSize: "11px" }} /> : null}
          {series.map((item) => (
            <Area
              key={item.key}
              type="monotone"
              dataKey={item.key}
              name={item.label}
              stackId={series.length > 1 ? "volume" : undefined}
              stroke={item.color}
              strokeWidth={2}
              fill={`url(#${gradientId}-${item.key})`}
              dot={false}
              activeDot={{ r: 4, strokeWidth: 0, fill: item.color }}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
