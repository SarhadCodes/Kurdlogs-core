import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';

interface StatsChartProps {
  data: Array<Record<string, unknown>>;
  dataKey: string;
  xKey?: string;
  label: string;
}

export default function StatsChart({ data, dataKey, xKey = 'time', label }: StatsChartProps) {
  return (
    <div className="bg-[#111] border border-[#333] rounded-lg p-4">
      <h3 className="text-sm font-medium text-[#888] mb-4">{label}</h3>
      <div className="h-52">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="#222" />
            <XAxis
              dataKey={xKey}
              stroke="#555"
              tick={{ fill: '#888', fontSize: 11 }}
              axisLine={{ stroke: '#333' }}
            />
            <YAxis
              stroke="#555"
              tick={{ fill: '#888', fontSize: 11 }}
              axisLine={{ stroke: '#333' }}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: '#111',
                border: '1px solid #333',
                borderRadius: '6px',
                color: '#fff',
                fontSize: '12px',
              }}
              labelStyle={{ color: '#888' }}
            />
            <Line
              type="monotone"
              dataKey={dataKey}
              stroke="#ffffff"
              strokeWidth={1.5}
              dot={false}
              activeDot={{ r: 4, fill: '#fff', stroke: '#333' }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
