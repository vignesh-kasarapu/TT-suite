import {
  RadarChart as ReRadarChart,
  Radar,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Legend,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'

export interface RadarSeriesConfig {
  /** Key into each data row's object for this series' value */
  key: string
  label: string
  color: string
  fillOpacity?: number
}

interface RadarChartProps {
  /** One row per axis, e.g. { axis: 'Skills', candidateA: 80, candidateB: 65 } */
  data: Record<string, string | number>[]
  /** Key into each data row holding the axis label. Defaults to 'axis'. */
  axisKey?: string
  series: RadarSeriesConfig[]
  height?: number
  domain?: [number, number]
}

export default function RadarChart({
  data,
  axisKey = 'axis',
  series,
  height = 260,
  domain = [0, 100],
}: RadarChartProps) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ReRadarChart data={data}>
        <PolarGrid />
        <PolarAngleAxis dataKey={axisKey} tick={{ fontSize: 11 }} />
        <PolarRadiusAxis angle={30} domain={domain} tick={{ fontSize: 9 }} />
        {series.map((s) => (
          <Radar
            key={s.key}
            name={s.label}
            dataKey={s.key}
            stroke={s.color}
            fill={s.color}
            fillOpacity={s.fillOpacity ?? 0.25}
          />
        ))}
        <Tooltip />
        <Legend />
      </ReRadarChart>
    </ResponsiveContainer>
  )
}
