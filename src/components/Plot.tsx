import { lazy, Suspense } from 'react'
import type { ComponentType } from 'react'
import type { PlotParams } from 'react-plotly.js/factory'
import type { Data, Layout, LayoutAxis } from 'plotly.js'

type AxisOptions = Omit<Partial<LayoutAxis>, 'title'> & {
  title?: string | { text?: string; standoff?: number }
}

type ChartLayout = Record<string, unknown> & {
  xaxis?: AxisOptions
  yaxis?: AxisOptions
  xaxis2?: AxisOptions
}

type Props = {
  data: Data[]
  layout?: ChartLayout
  id?: string
  className?: string
  onHover?: (event: { points: Array<{ x: number; y: number }> }) => void
  onClick?: (event: { points: Array<{ x: number; y: number }> }) => void
  onRelayout?: (event: Record<string, number | string | boolean>) => void
  onAfterPlot?: () => void
}

const Plot = lazy(async () => {
  ;(globalThis as typeof globalThis & { global?: typeof globalThis }).global ??= globalThis
  const [{ default: createPlotlyComponent }, { default: plotly }, { default: scatter }, { default: heatmap }, { default: scatterpolar }] = await Promise.all([
    import('react-plotly.js/factory'),
    import('plotly.js/lib/core'),
    import('plotly.js/lib/scatter'),
    import('plotly.js/lib/heatmap'),
    import('plotly.js/lib/scatterpolar'),
  ])
  plotly.register([scatter, heatmap, scatterpolar])
  return { default: createPlotlyComponent(plotly) as ComponentType<PlotParams> }
})

const baseLayout: Partial<Layout> = {
  autosize: true,
  margin: { l: 54, r: 18, t: 18, b: 48 },
  paper_bgcolor: 'transparent',
  plot_bgcolor: 'transparent',
  font: { family: 'DM Sans, sans-serif', color: '#53615c', size: 11 },
  xaxis: { gridcolor: '#e9ece7', zerolinecolor: '#d8dfd8', linecolor: '#d8dfd8', ticks: 'outside' },
  yaxis: { gridcolor: '#e9ece7', zerolinecolor: '#d8dfd8', linecolor: '#d8dfd8', ticks: 'outside' },
  legend: { orientation: 'h', y: 1.12, x: 0.02, font: { size: 10 } },
  hoverlabel: { bgcolor: '#172a25', bordercolor: '#172a25', font: { color: '#fff', family: 'DM Sans, sans-serif' } },
}

export default function Chart({ data, layout, id, className, onHover, onClick, onRelayout, onAfterPlot }: Props) {
  const normalizeAxis = (axis?: AxisOptions): Partial<LayoutAxis> | undefined => {
    if (!axis) return undefined
    return { ...axis, title: typeof axis.title === 'string' ? { text: axis.title } : axis.title }
  }
  const plotLayout = {
    ...baseLayout,
    ...layout,
    xaxis: { ...baseLayout.xaxis, ...normalizeAxis(layout?.xaxis) },
    yaxis: { ...baseLayout.yaxis, ...normalizeAxis(layout?.yaxis) },
    ...(layout?.xaxis2 ? { xaxis2: normalizeAxis(layout.xaxis2) } : {}),
  } as Partial<Layout>

  return (
    <div className={className ?? 'plot-wrap'} id={id}>
      <Suspense fallback={<div className="plot-loading" aria-label="Laster graf" />}>
        <Plot
          data={data}
          layout={plotLayout}
          useResizeHandler
          style={{ width: '100%', height: '100%' }}
          config={{ responsive: true, displaylogo: false, modeBarButtonsToRemove: ['lasso2d', 'select2d'] }}
          onError={(error) => console.error('Plotly rendering failed:', error, plotLayout)}
          onHover={onHover}
          onClick={onClick}
          onRelayout={onRelayout}
          onAfterPlot={onAfterPlot}
        />
      </Suspense>
    </div>
  )
}
