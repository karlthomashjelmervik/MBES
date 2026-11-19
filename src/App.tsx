import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import katex from 'katex'
import {
  Activity, ArrowDown, ArrowRight, AudioLines,
  Check, CircleHelp, Download, ExternalLink, Info,
  RotateCcw, Waves,
} from 'lucide-react'
import Chart from './components/Plot'
import ActiveSonar from './components/ActiveSonar'
import {
  angleFromInvariant, BOTTOM_DEPTH, errorMetrics, profileSpeed, SURFACE_SPEED,
  quadraticInterpolation, simulateBeams, SOURCE_DEPTH, traceForTime,
  traceRayPath, traceToDepth,
} from './lib/physics'
import type { Point } from './lib/physics'
import type { Data } from 'plotly.js'
import { localizeTree } from './lib/localization'
import type { Language } from './lib/localization'

const colors = { ink: '#28252c', muted: '#6f6a74', green: '#7800f0', red: '#db654f', blue: '#3976b8', line: '#e8e4ed' }
const SSP_GRADIENT_MIN = -0.5
const SSP_GRADIENT_MAX = 0.5
const SSP_GRADIENT_STEP = 0.005
const LanguageContext = createContext<Language>('no')
const seabedSegments = [
  { start: [0, 300], control: [70, 286], end: [130, 303] },
  { start: [130, 303], control: [190, 320], end: [260, 295] },
  { start: [260, 295], control: [330, 270], end: [390, 310] },
  { start: [390, 310], control: [450, 350], end: [520, 291] },
  { start: [520, 291], control: [590, 232], end: [600, 301] },
]
function seabedYAt(x: number) {
  const segment = seabedSegments.find(({ end }) => x <= end[0]) ?? seabedSegments[seabedSegments.length - 1]
  let low = 0
  let high = 1
  for (let iteration = 0; iteration < 24; iteration += 1) {
    const t = (low + high) / 2
    const inverseT = 1 - t
    const curveX = inverseT ** 2 * segment.start[0] + 2 * inverseT * t * segment.control[0] + t ** 2 * segment.end[0]
    if (curveX < x) low = t
    else high = t
  }
  const t = (low + high) / 2
  const inverseT = 1 - t
  return inverseT ** 2 * segment.start[1] + 2 * inverseT * t * segment.control[1] + t ** 2 * segment.end[1]
}
const beamRays = Array.from({ length: 11 }, (_, index) => {
  const angle = (index - 5) * 5
  const slope = Math.tan((angle * Math.PI) / 180)
  let low = 250
  let high = 330
  for (let iteration = 0; iteration < 24; iteration += 1) {
    const depth = (low + high) / 2
    const x = 300 + (depth - 80) * slope
    if (depth < seabedYAt(x)) low = depth
    else high = depth
  }
  const depth = (low + high) / 2
  return { x: 300 + (depth - 80) * slope, y: depth }
})
const fanFloorPoints = Array.from({ length: 42 }, (_, index) => {
  const leftX = beamRays[0].x
  const rightX = beamRays[beamRays.length - 1].x
  const x = leftX + ((rightX - leftX) * index) / 41
  return `${x.toFixed(2)} ${seabedYAt(x).toFixed(2)}`
})
const fanAreaPath = `M300 80 L${beamRays[0].x.toFixed(2)} ${beamRays[0].y.toFixed(2)} L${fanFloorPoints.join(' L')} L${beamRays[beamRays.length - 1].x.toFixed(2)} ${beamRays[beamRays.length - 1].y.toFixed(2)} Z`
const sectionLinks = [
  ['propagation', 'Propagasjon'], ['reflection', 'Refleksjon'], ['snell', 'Snells lov'],
  ['reflection-coefficient', 'Refleksjonskoeffisient'], ['invariant', 'Stråleinvariant'],
  ['errors', 'SSP-feil'], ['simulator', 'Simulator'], ['asw', 'ASW-deteksjon'], ['quiz', 'Test deg'],
]

function Formula({ math }: { math: string }) {
  return <div dangerouslySetInnerHTML={{ __html: katex.renderToString(math, { displayMode: true, throwOnError: false }) }} />
}

function fmt(value: number, digits = 2, locale = 'nb-NO') {
  return new Intl.NumberFormat(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value)
}

function SectionHeading({ number, eyebrow, title, description }: { number: string; eyebrow: string; title: string; description?: string }) {
  return (
    <div className="section-heading">
      <div className="section-index">{number}</div>
      <div><span className="eyebrow">{eyebrow}</span><h2>{title}</h2>{description && <p>{description}</p>}</div>
    </div>
  )
}

function Slider({ label, value, min, max, step, unit, onChange, onCommit, marks }: {
  label: string; value: number; min: number; max: number; step: number; unit: string
  onChange: (value: number) => void; onCommit?: (value: number) => void; marks?: [string, string]
}) {
  const language = useContext(LanguageContext)
  const locale = language === 'en' ? 'en-GB' : 'nb-NO'
  return (
    <label className="slider-control">
      <span className="slider-top"><span>{label}</span><strong>{fmt(value, step < 0.01 ? 3 : step < 1 ? 1 : 0, locale)} <small>{unit}</small></strong></span>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
        onPointerUp={(event) => onCommit?.(Number(event.currentTarget.value))}
        onKeyUp={(event) => onCommit?.(Number(event.currentTarget.value))} />
      {marks && <span className="slider-marks"><span>{marks[0]}</span><span>{marks[1]}</span></span>}
    </label>
  )
}

function ModuleFrame({ children, label, title, action }: { children: React.ReactNode; label?: string; title: string; action?: React.ReactNode }) {
  return <div className="module-frame"><div className="module-header"><div>{label && <span className="eyebrow">{label}</span>}<h3>{title}</h3></div>{action}</div>{children}</div>
}

function CardNote({ children }: { children: React.ReactNode }) {
  return <div className="note"><Info size={15} strokeWidth={1.8} /><p>{children}</p></div>
}

function LearningNote({ items }: { items: string[] }) {
  const language = useContext(LanguageContext)
  return localizeTree(
    <aside className="learning-note"><h3>Legg merke til</h3><ul>{items.map((item) => <li key={item}>{item}</li>)}</ul></aside>,
    language,
  )
}

function TrySelfBox({ norwegian, english }: { norwegian: string; english: string }) {
  const language = useContext(LanguageContext)
  return (
    <aside className="try-self-box">
      <CircleHelp size={17} strokeWidth={1.8} />
      <div>
        <h3>{language === 'en' ? 'Try it yourself' : 'Prøv selv'}</h3>
        <p>{language === 'en' ? english : norwegian}</p>
      </div>
    </aside>
  )
}

function RayTubeDiagram() {
  const language = useContext(LanguageContext)
  return localizeTree((
    <ModuleFrame label="01.2 · STRÅLETUBE" title="Tre stråler avgrenser et tverrsnittsareal">
      <div className="ray-tube-visual">
        <svg viewBox="0 0 620 360" role="img" aria-label="Trekantet stråletube avgrenset av tre svarte stråler. To røde, halvtransparente tverrsnitt er markert med A1 og A2.">
          <defs>
            <marker id="ray-arrow-black" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0L10 5L0 10z" fill="#18332c" /></marker>
          </defs>
          <path d="M100 280L500 280L340 60Z" fill="#dce9e4" fillOpacity=".12" />
          <path d="M100 280L340 60L540 170Z" fill="#dce9e4" fillOpacity=".12" />
          <path d="M100 280L540 170L500 280Z" fill="#dce9e4" fillOpacity=".12" />
          <path d="M500 280L340 60L540 170Z" fill="none" stroke="#91a99a" strokeWidth="1.2" strokeDasharray="5 5" />
          <path d="M233 280L180 207L247 243Z" fill="#e5876f" fillOpacity=".34" stroke="#bf6655" strokeWidth="1.8" />
          <path d="M367 280L260 133L393 207Z" fill="#e5876f" fillOpacity=".4" stroke="#bf6655" strokeWidth="1.8" />
          <path d="M100 280L500 280" fill="none" stroke="#18332c" strokeWidth="2.6" markerEnd="url(#ray-arrow-black)" />
          <path d="M100 280L340 60" fill="none" stroke="#18332c" strokeWidth="2.6" markerEnd="url(#ray-arrow-black)" />
          <path d="M100 280L540 170" fill="none" stroke="#18332c" strokeWidth="2.6" markerEnd="url(#ray-arrow-black)" />
          <path d="M233 280L180 207L247 243Z" fill="none" stroke="#bf6655" strokeWidth="1.4" />
          <path d="M367 280L260 133L393 207Z" fill="none" stroke="#bf6655" strokeWidth="1.4" />
          <circle cx="100" cy="280" r="7" fill="#18332c" stroke="#fff" strokeWidth="2" />
          <text x="209" y="249" fill="#8f4e43" fontFamily="DM Sans, sans-serif" fontSize="21" fontStyle="italic">A<tspan fontSize="13" baselineShift="sub">1</tspan></text>
          <text x="329" y="212" fill="#8f4e43" fontFamily="DM Sans, sans-serif" fontSize="21" fontStyle="italic">A<tspan fontSize="13" baselineShift="sub">2</tspan></text>
          <text x="245" y="328" fill="#70817a" fontFamily="DM Mono, monospace" fontSize="10" letterSpacing="1">TVERRSNITTSAREAL</text>
          <text x="68" y="306" fill="#70817a" fontFamily="DM Mono, monospace" fontSize="9">FELLES START</text>
          <text x="407" y="102" fill="#70817a" fontFamily="DM Mono, monospace" fontSize="10">UTBREDELSESRETNING</text>
        </svg>
      </div>
    </ModuleFrame>
  ), language)
}

function SeafloorErrorDiagram() {
  const language = useContext(LanguageContext)
  return localizeTree((
    <div className="seafloor-error-diagram">
      <div className="seafloor-error-legend">
        <span><i className="seafloor-line actual" />Faktisk bunn</span>
        <span><i className="seafloor-line calculated" />Beregnet bunn</span>
      </div>
      <svg viewBox="0 0 900 272" role="img" aria-label="Tre skisser viser at korrekt lydhastighetsprofil gir riktig bunn, mens feil profil kan gi smilende eller sur bunn i kartet.">
        <defs>
          <pattern id="seafloor-grid" width="24" height="24" patternUnits="userSpaceOnUse"><path d="M24 0H0V24" fill="none" stroke="#e7ebe6" strokeWidth="1" /></pattern>
        </defs>
        <g>
          <rect x="12" y="12" width="280" height="246" fill="#fbfcf9" stroke="#e3e9e2" />
          <rect x="324" y="12" width="264" height="246" fill="#fbfcf9" stroke="#e3e9e2" />
          <rect x="636" y="12" width="252" height="246" fill="#fbfcf9" stroke="#e3e9e2" />
          <path d="M24 72H280V236H24zM336 72H576V236H336zM648 72H876V236H648z" fill="url(#seafloor-grid)" />
        </g>
        <g fill="#28252c" fontFamily="DM Sans, sans-serif">
          <text x="28" y="42" fontSize="15" fontWeight="700">Korrekt SSP</text>
          <text x="28" y="61" fontSize="10" fill="#68776f">Beregnet bunn følger faktisk bunn</text>
          <text x="340" y="42" fontSize="15" fontWeight="700">Feil SSP: smil</text>
          <text x="340" y="61" fontSize="10" fill="#68776f">Grunnere i kantene, dypere i midten</text>
          <text x="652" y="42" fontSize="15" fontWeight="700">Feil SSP: sur</text>
          <text x="652" y="61" fontSize="10" fill="#68776f">Dypere i kantene, grunnere i midten</text>
        </g>
        <path d="M30 158H274" fill="none" stroke="#28252c" strokeWidth="3" />
        <path d="M30 163H274" fill="none" stroke="#3976b8" strokeWidth="2.5" strokeDasharray="7 5" />
        <path d="M340 158H572" fill="none" stroke="#28252c" strokeWidth="3" />
        <path d="M340 158Q456 218 572 158" fill="none" stroke="#3976b8" strokeWidth="3" strokeDasharray="8 5" />
        <path d="M652 158H872" fill="none" stroke="#28252c" strokeWidth="3" />
        <path d="M652 158Q762 98 872 158" fill="none" stroke="#3976b8" strokeWidth="3" strokeDasharray="8 5" />
        <g fill="#3976b8" stroke="#fff" strokeWidth="1.5">
          <circle cx="30" cy="163" r="4" /><circle cx="91" cy="163" r="4" /><circle cx="152" cy="163" r="4" /><circle cx="213" cy="163" r="4" /><circle cx="274" cy="163" r="4" />
          <circle cx="340" cy="158" r="4" /><circle cx="398" cy="181" r="4" /><circle cx="456" cy="188" r="4" /><circle cx="514" cy="181" r="4" /><circle cx="572" cy="158" r="4" />
          <circle cx="652" cy="158" r="4" /><circle cx="707" cy="135" r="4" /><circle cx="762" cy="128" r="4" /><circle cx="817" cy="135" r="4" /><circle cx="872" cy="158" r="4" />
        </g>
        <g fill="#68776f" fontFamily="DM Sans, sans-serif" fontSize="10" textAnchor="middle">
          <text x="152" y="215">Små posisjonsfeil</text>
          <text x="456" y="239">Bunnen ser ut som et smil</text>
          <text x="762" y="215">Bunnen ser ut som en sur munn</text>
        </g>
      </svg>
    </div>
  ), language)
}

function App() {
  const [language, setLanguage] = useState<Language>('no')
  const [frequency, setFrequency] = useState(40000)
  const [soundSpeed, setSoundSpeed] = useState(SURFACE_SPEED)
  const [maxPlotDistance, setMaxPlotDistance] = useState((SURFACE_SPEED / 15000) * 10)
  const [reflectionAngle, setReflectionAngle] = useState(38)
  const [transmissionAngle, setTransmissionAngle] = useState(35)
  const [cMedium1, setCMedium1] = useState(1480)
  const [rhoMedium1, setRhoMedium1] = useState(1025)
  const [cMedium2, setCMedium2] = useState(1600)
  const [rhoMedium2, setRhoMedium2] = useState(1800)
  const [c1, setC1] = useState(1480)
  const [c2, setC2] = useState(1530)
  const [snellAngle, setSnellAngle] = useState(32)
  const [rayAngle, setRayAngle] = useState(70)
  const [rayGradient, setRayGradient] = useState(0)
  const [hoverPoint, setHoverPoint] = useState<Point>({ x: 0, z: SOURCE_DEPTH })
  const [draftGradient, setDraftGradient] = useState(0)
  const [appliedGradient, setAppliedGradient] = useState(0)
  const [draftMeasuredGradient, setDraftMeasuredGradient] = useState(0)
  const [appliedMeasuredGradient, setAppliedMeasuredGradient] = useState(0)
  const [answers, setAnswers] = useState<Record<number, number>>({})
  const numberLocale = language === 'en' ? 'en-GB' : 'nb-NO'

  useEffect(() => {
    document.documentElement.lang = language
    document.title = language === 'en' ? 'Hydroacoustics · Field Lab' : 'Hydroakustikk · Feltlab'
    const description = document.querySelector('meta[name="description"]')
    description?.setAttribute('content', language === 'en'
      ? 'Interactive learning resource and MBES simulator for hydroacoustics and sound-speed profiles.'
      : 'Interaktivt læreverk og MBES-simulator for hydroakustikk og lydhastighetsprofiler.')
  }, [language])

  const rayProfileDepth = 3000
  const wavelength = soundSpeed / frequency
  const wavefrontCount = Math.floor(maxPlotDistance / wavelength)
  const annotatedWavefrontRadius = wavelength * Math.max(1, Math.floor(wavefrontCount * 0.7))
  const waveAnnotations = [
    ...(wavefrontCount > 0 ? [{ x: -annotatedWavefrontRadius * Math.SQRT1_2, y: annotatedWavefrontRadius * Math.SQRT1_2, text: 'Bølgefront', showarrow: true, arrowhead: 2, ax: 48, ay: -35, arrowcolor: '#a784c4', font: { color: '#765393', size: 10 }, bgcolor: 'rgba(255,255,255,0.88)', borderpad: 3 }] : []),
    { x: maxPlotDistance * 0.68, y: maxPlotDistance * 0.68 * Math.tan(Math.PI / 6), text: 'Stråle', showarrow: true, arrowhead: 2, ax: 45, ay: 35, arrowcolor: colors.ink, font: { color: colors.ink, size: 10 }, bgcolor: 'rgba(255,255,255,0.88)', borderpad: 3 },
  ]
  const waveLayout = { xaxis: { title: 'Avstand (m)', range: [-maxPlotDistance, maxPlotDistance] as [number, number], zeroline: false }, yaxis: { title: 'Avstand (m)', range: [-maxPlotDistance, maxPlotDistance] as [number, number], scaleanchor: 'x' as const, scaleratio: 1, zeroline: false }, annotations: waveAnnotations, showlegend: false }
  const refractedSine = (c2 / c1) * Math.sin((snellAngle * Math.PI) / 180)
  const totalReflection = Math.abs(refractedSine) > 1
  const refractedAngle = totalReflection ? NaN : Math.asin(refractedSine) * (180 / Math.PI)
  const invariantRay = useMemo(() => traceRayPath(rayAngle, rayGradient, rayProfileDepth, 50000), [rayAngle, rayGradient])
  const currentSpeed = profileSpeed(rayGradient, hoverPoint.z)
  const currentP = Math.sin((rayAngle * Math.PI) / 180) / profileSpeed(rayGradient, SOURCE_DEPTH)
  const currentAngle = angleFromInvariant(currentP, currentSpeed)
  const beams = useMemo(() => simulateBeams(appliedGradient, appliedMeasuredGradient), [appliedGradient, appliedMeasuredGradient])
  const metrics = useMemo(() => errorMetrics(beams), [beams])
  const seabedCurve = useMemo(() => quadraticInterpolation(beams.map((beam) => beam.estimatedHit)), [beams])

  const waveTraces = useMemo(() => {
    const traces = []
    const theta = Array.from({ length: 100 }, (_, index) => (index / 99) * Math.PI * 2)
    for (let ring = 1; ring <= wavefrontCount; ring += 1) {
      traces.push({ x: theta.map((angle) => Math.cos(angle) * wavelength * ring), y: theta.map((angle) => Math.sin(angle) * wavelength * ring), mode: 'lines' as const, line: { color: ring === 1 ? colors.green : '#cbb4df', width: ring === 1 ? 2 : 1 }, hoverinfo: 'skip' as const })
    }
    for (let angle = 0; angle < 360; angle += 30) {
      const radians = (angle * Math.PI) / 180
      const reach = Math.min(maxPlotDistance / Math.abs(Math.cos(radians)), maxPlotDistance / Math.abs(Math.sin(radians)))
      traces.push({ x: [0, reach * Math.cos(radians)], y: [0, reach * Math.sin(radians)], mode: 'lines+markers' as const, line: { color: colors.ink, width: 1.5 }, marker: { symbol: 'triangle-right', angle, size: [0, 7], color: colors.ink }, hoverinfo: 'skip' as const })
    }
    return traces
  }, [wavelength, maxPlotDistance])

  const reflectionTraces = useMemo(() => {
    const angle = (reflectionAngle * Math.PI) / 180
    const reach = 7
    const offset = Math.tan(angle) * reach
    return [
      { x: [-offset, 0], y: [reach, 0], mode: 'lines+markers', line: { color: colors.red, width: 3 }, marker: { symbol: ['circle', 'circle'], size: [0, 7] }, name: 'Innkommende' },
      { x: [0, offset], y: [0, reach], mode: 'lines+markers', line: { color: colors.blue, width: 3 }, marker: { symbol: ['circle', 'circle'], size: [0, 7] }, name: 'Reflektert' },
      { x: [0, 0], y: [-1.3, 2.1], mode: 'lines', line: { color: '#65746d', width: 1.5, dash: 'dot' }, name: 'Normal' },
      { x: [-9, 9], y: [0, 0], mode: 'lines', line: { color: '#83a99b', width: 3 }, name: 'Havbunn' },
    ]
  }, [reflectionAngle])

  const transmissionResult = useMemo(() => {
    const incidence = (transmissionAngle * Math.PI) / 180
    const sineTransmitted = (cMedium2 / cMedium1) * Math.sin(incidence)
    const totalInternalReflection = Math.abs(sineTransmitted) > 1
    const transmitted = totalInternalReflection ? NaN : Math.asin(sineTransmitted)
    let pressureReflection = 0
    if (!totalInternalReflection) {
      const zIncident = (rhoMedium1 * cMedium1) / Math.cos(incidence)
      const zTransmitted = (rhoMedium2 * cMedium2) / Math.cos(transmitted)
      pressureReflection = (zTransmitted - zIncident) / (zTransmitted + zIncident)
    } else {
      pressureReflection = 1
    }
    const reflectionIntensity = totalInternalReflection ? 1 : pressureReflection ** 2
    const transmissionIntensity = 1 - reflectionIntensity
    const bottomLoss = -10 * Math.log10(Math.max(reflectionIntensity, 1e-6))
    return { transmitted, totalInternalReflection, pressureReflection, reflectionIntensity, transmissionIntensity, bottomLoss }
  }, [transmissionAngle, cMedium1, rhoMedium1, cMedium2, rhoMedium2])

  const transmissionTraces = useMemo(() => {
    const incidence = (transmissionAngle * Math.PI) / 180
    const reach = 7
    const incomingOffset = Math.tan(incidence) * reach
    const transmittedAngle = transmissionResult.transmitted
    const transmittedOffset = transmissionResult.totalInternalReflection
      ? 0
      : Math.tan(transmittedAngle) * reach
    const reflectedWidth = 0.8 + 6.2 * transmissionResult.reflectionIntensity
    const transmittedWidth = 0.8 + 6.2 * transmissionResult.transmissionIntensity
    const traces: Data[] = [
      { x: [-incomingOffset, 0], y: [reach, 0], mode: 'lines+markers', line: { color: colors.red, width: 3.2 }, marker: { symbol: ['circle', 'circle'], size: [0, 8] }, name: language === 'en' ? 'Incident' : 'Innkommende' },
      { x: [0, incomingOffset], y: [0, reach], mode: 'lines+markers', line: { color: colors.blue, width: reflectedWidth }, marker: { symbol: ['circle', 'triangle-up'], size: [0, 8] }, name: language === 'en' ? 'Reflected' : 'Reflektert' },
      {
        x: [0, transmittedOffset],
        y: [0, -reach],
        mode: 'lines+markers',
        line: {
          color: colors.blue,
          width: transmittedWidth,
          dash: 'dot',
        },
        marker: { symbol: ['circle', 'triangle-down'], size: [0, 8] },
        name: language === 'en' ? 'Transmitted' : 'Transmittert',
      },
      { x: [0, 0], y: [-8.2, 8.2], mode: 'lines', line: { color: '#65746d', width: 1.5, dash: 'dot' }, name: language === 'en' ? 'Normal' : 'Normal', hoverinfo: 'skip' },
      { x: [-9, 9], y: [0, 0], mode: 'lines', line: { color: '#83a99b', width: 3 }, name: language === 'en' ? 'Boundary' : 'Grenseflate', hoverinfo: 'skip' },
    ]
    if (transmissionResult.totalInternalReflection) {
      traces[2] = { x: [0, incomingOffset], y: [0, -reach], mode: 'lines+markers', line: { color: colors.blue, width: transmittedWidth, dash: 'dot' }, marker: { symbol: ['circle', 'triangle-down'], size: [0, 8] }, name: language === 'en' ? 'No transmission' : 'Ingen transmisjon' }
    }
    return traces
  }, [language, transmissionAngle, transmissionResult])

  const transmissionIntensityTraces = useMemo<Data[]>(() => {
    const angles = Array.from({ length: 91 }, (_, index) => index)
    const reflected: number[] = []
    const transmitted: number[] = []

    angles.forEach((angleDegrees) => {
      const incidence = (angleDegrees * Math.PI) / 180
      const sineTransmitted = (cMedium2 / cMedium1) * Math.sin(incidence)
      if (Math.abs(sineTransmitted) > 1) {
        reflected.push(100)
        transmitted.push(0)
        return
      }
      const transmittedAngle = Math.asin(sineTransmitted)
      const zIncident = (rhoMedium1 * cMedium1) / Math.cos(incidence)
      const zTransmitted = (rhoMedium2 * cMedium2) / Math.cos(transmittedAngle)
      const pressureReflection = (zTransmitted - zIncident) / (zTransmitted + zIncident)
      const reflectionIntensity = pressureReflection ** 2
      reflected.push(reflectionIntensity * 100)
      transmitted.push((1 - reflectionIntensity) * 100)
    })

    return [
      { x: angles, y: transmitted, mode: 'lines', name: language === 'en' ? 'Transmitted intensity' : 'Transmittert intensitet', line: { color: colors.blue, width: 3 } },
      { x: angles, y: reflected, mode: 'lines', name: language === 'en' ? 'Reflected intensity' : 'Reflektert intensitet', line: { color: colors.blue, width: 3, dash: 'dot' } },
      { x: [transmissionAngle], y: [0], mode: 'markers', name: language === 'en' ? 'Selected angle of incidence' : 'Valgt innfallsvinkel', marker: { color: colors.red, size: 9, symbol: 'diamond' }, hovertemplate: language === 'en' ? 'Selected angle %{x:.0f}°<extra></extra>' : 'Valgt vinkel %{x:.0f}°<extra></extra>' },
    ]
  }, [language, transmissionAngle, cMedium1, rhoMedium1, cMedium2, rhoMedium2])

  const speedProfileTraces = useMemo<Data[]>(() => {
    const depth = Array.from({ length: 101 }, (_, index) => index * (rayProfileDepth / 100))
    return [
      { x: depth.map((z) => profileSpeed(rayGradient, z)), y: depth, mode: 'lines', name: language === 'en' ? 'Sound speed' : 'Lydhastighet', line: { color: colors.green, width: 2.5 } },
    ]
  }, [language, rayGradient, rayProfileDepth])

  const rayProfileTraces = useMemo<Data[]>(() => {
    const launchRadians = (rayAngle * Math.PI) / 180
    const launchLength = 18
    return [
      { x: [0, 50], y: [rayProfileDepth, rayProfileDepth], mode: 'lines', name: language === 'en' ? 'Seafloor · 3000 m' : 'Havbunn · 3000 m', line: { color: colors.ink, width: 2 }, hoverinfo: 'skip' },
      { x: invariantRay.points.map((point) => point.x / 1000), y: invariantRay.points.map((point) => point.z), mode: 'lines', name: language === 'en' ? 'Ray' : 'Stråle', line: { color: colors.red, width: 3 }, customdata: invariantRay.points.map((point) => [profileSpeed(rayGradient, point.z), angleFromInvariant(currentP, profileSpeed(rayGradient, point.z)), currentP]), hovertemplate: language === 'en' ? 'x %{x:.2f} km<br>z %{y:.1f} m<extra></extra>' : 'x %{x:.2f} km<br>z %{y:.1f} m<extra></extra>' },
      { x: [0, launchLength * Math.sin(launchRadians) / 1000], y: [SOURCE_DEPTH, SOURCE_DEPTH + launchLength * Math.cos(launchRadians)], mode: 'lines+markers+text', name: language === 'en' ? `Launch angle ${rayAngle}°` : `Startvinkel ${rayAngle}°`, line: { color: colors.ink, width: 1.5, dash: 'dot' }, marker: { color: colors.ink, size: [7, 0] }, text: ['', `θ₀ ${rayAngle}°`], textposition: 'top right', hoverinfo: 'skip' },
    ]
  }, [language, rayAngle, rayGradient, invariantRay, currentP, rayProfileDepth])

  const trueProfileDepth = Array.from({ length: 101 }, (_, index) => index)
  const simulatorSpeedRange = [Math.min(SURFACE_SPEED, profileSpeed(appliedGradient, 100), profileSpeed(appliedMeasuredGradient, 100)), Math.max(SURFACE_SPEED, profileSpeed(appliedGradient, 100), profileSpeed(appliedMeasuredGradient, 100))]
  const invariantSpeedRange = [profileSpeed(rayGradient, 0), profileSpeed(rayGradient, rayProfileDepth)]
  const simulatorProfile = [
    { x: trueProfileDepth.map((depth) => profileSpeed(appliedGradient, depth)), y: trueProfileDepth, mode: 'lines', name: language === 'en' ? 'True SSP' : 'Sann SSP', line: { color: colors.red, width: 2.7 } },
    { x: trueProfileDepth.map((depth) => profileSpeed(appliedMeasuredGradient, depth)), y: trueProfileDepth, mode: 'lines', name: language === 'en' ? 'Measured SSP' : 'Målt SSP', line: { color: colors.blue, width: 2.7, dash: 'dash' } },
  ]

  const rayTraces = useMemo(() => {
    const traces = []
    for (let angle = -60; angle <= 60; angle += 5) {
      const truth = traceToDepth(angle, appliedGradient)
      const estimate = traceForTime(angle, appliedMeasuredGradient, truth.travelTime)
      traces.push({ x: truth.points.map((point) => point.x), y: truth.points.map((point) => point.z), mode: 'lines' as const, showlegend: false, hoverinfo: 'skip' as const, line: { color: 'rgba(219,101,79,0.58)', width: 1.5 } })
      traces.push({ x: estimate.points.map((point) => point.x), y: estimate.points.map((point) => point.z), mode: 'lines' as const, showlegend: false, hoverinfo: 'skip' as const, line: { color: 'rgba(57,118,184,0.56)', width: 1.3, dash: 'dash' as const } })
    }
    traces.push({ x: [-230, 230], y: [BOTTOM_DEPTH, BOTTOM_DEPTH], mode: 'lines' as const, name: 'Sann havbunn', line: { color: colors.ink, width: 2 } })
    traces.push({ x: [0], y: [SOURCE_DEPTH], mode: 'markers' as const, name: 'MBES', marker: { color: colors.green, size: 10, symbol: 'diamond' } })
    return traces
  }, [appliedGradient, appliedMeasuredGradient])

  const uploadDownload = (name: string, content: string, type: string) => {
    const url = URL.createObjectURL(new Blob([content], { type }))
    const link = document.createElement('a')
    link.href = url
    link.download = name
    link.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  const exportPlot = async (id: string, format: 'png' | 'svg') => {
    const graph = document.querySelector(`#${id} .js-plotly-plot`) as HTMLDivElement | null
    if (!graph) return
    const Plotly = await import('plotly.js-basic-dist-min')
    await Plotly.default.downloadImage(graph, { format, filename: `mbes-${id}`, width: 1400, height: 850, scale: 2 })
  }

  const exportCsv = () => {
    const rows = [language === 'en'
      ? 'angle_deg,x_true_m,z_true_m,x_estimated_m,z_estimated_m,round_trip_time_s'
      : 'vinkel_deg,x_sann_m,z_sann_m,x_estimert_m,z_estimert_m,reisetid_tur_retur_s']
    beams.forEach((beam) => rows.push([beam.angle, beam.trueHit.x, beam.trueHit.z, beam.estimatedHit.x, beam.estimatedHit.z, beam.travelTime].join(',')))
    uploadDownload(language === 'en' ? 'mbes-bathymetry.csv' : 'mbes-batymetri.csv', rows.join('\n'), 'text/csv;charset=utf-8')
  }

  const commitGradient = (value: number) => { setDraftGradient(value); setAppliedGradient(value) }

  const quizItems = language === 'en'
    ? [
      { question: 'What occurs at a boundary when sound travels from water into another medium and the angle of incidence is greater than the critical angle?', options: ['Total reflection', 'Full transmission', 'The sound is completely absorbed'], answer: 0, explain: 'The angle of incidence exceeds the limit for transmission, so nearly all the sound energy is reflected.' },
      { question: 'When is bottom loss low?', options: ['When the reflection coefficient is large', 'When transmission is large', 'When the density is the same in the seabed'], answer: 0, explain: 'Bottom loss is BL = -10 log₁₀(RI). A large reflected fraction therefore gives low bottom loss.' },
      { question: 'What happens to the reflected and transmitted fractions if the two media have nearly the same acoustic impedance?', options: ['Nearly all is reflected', 'Nearly all is transmitted', 'Reflection is always complete'], answer: 1, explain: 'When the impedances are similar, pressure reflection is small and a large part of the sound is transmitted.' },
      { question: 'What does the ray parameter p = sin(θ)/c describe in a horizontally stratified ocean?', options: ['A quantity that remains constant along the ray', 'The seabed acoustic impedance', 'The wavelength of the light ray'], answer: 0, explain: 'In a sound-speed profile that varies only with depth, the ray parameter is conserved along the ray.' },
      { question: 'What happens to the local ray angle if sound speed increases along the ray?', options: ['The angle increases, assuming p is constant', 'The angle always decreases', 'The angle does not change'], answer: 0, explain: 'From p = sin(θ)/c, sin(θ) must increase when c increases, so the angle from the vertical increases.' },
      { question: 'What is the effect of a negative sound-speed gradient?', options: ['Sound bends upward', 'Sound bends downward', 'Sound stops at the seafloor'], answer: 1, explain: 'With a negative gradient, sound speed decreases with depth, and the ray bends downward.' },
      { question: 'What must a multibeam echosounder combine to calculate position and depth?', options: ['Temperature and salinity', 'Travel time and modeled ray path', 'Horizontal range only'], answer: 1, explain: 'Travel time and the calculated ray path from the SSP are used to find each seafloor intersection.' },
      { question: 'How is round-trip time used in multibeam depth measurement?', options: ['It is halved before the position is calculated', 'It is multiplied by frequency', 'It is used only to measure temperature'], answer: 0, explain: 'The sound travels out and back, so ray paths and position are calculated using the one-way time.' },
      { question: 'What is the term for systematic seafloor deviations that follow the beam fan when the SSP is wrong?', options: ['Smile-shaped or frown-shaped seabed artifacts', 'Surface resonances', 'Acoustic nulls'], answer: 0, explain: 'An incorrectly modeled ray path can distort a flat seabed map into a smile or frown shape.' },
      { question: 'What is the main advantage of placing the sonar in a sound channel?', options: ['Sound travels along the seabed without dB loss', 'Rays stay concentrated, reducing geometric spreading loss', 'The sonar is more stable'], answer: 1, explain: 'In a sound channel, rays bend toward the region with the lowest sound speed, keeping sound concentrated over greater distances.' },
    ]
    : [
      { question: 'Hva oppstår ved en grenseflate når lyd beveger seg fra vann til en annen medie og innfallsvinkelen er større enn totalrefleksjonsvinkelen?', options: ['Totalrefleksjon', 'Full transmisjon', 'Lyden blir helt absorbert'], answer: 0, explain: 'Da overstiger innfallsvinkelen grensen for transmisjon, og nærmest all lydenergi reflekteres.' },
      { question: 'Når er bunntapet lavt?', options: ['Når refleksjonskoeffisienten er stor', 'Når transmisjonen er stor', 'Når tettheten er lik i havbunnen'], answer: 0, explain: 'Bunntapet er BL = -10 log₁₀(RI). En stor refleksjonsandel gir derfor lavt bunntap.' },
      { question: 'Hva skjer med refleksjons- og transmisjonsandelen dersom de to mediene har nesten samme akustiske impedans?', options: ['Nesten alt reflekteres', 'Nesten alt transmitteres', 'Refleksjonen blir alltid fullstendig'], answer: 1, explain: 'Når impedansene er like, blir trykkrefleksjonen liten og en stor del av lyden transmitteres.' },
      { question: 'Hva beskriver ray parameteren p = sin(θ)/c i et horisontalt lagdelt hav?', options: ['En størrelse som holdes konstant langs strålen', 'Havbunnens akustiske impedans', 'Lystrålens bølgelengde'], answer: 0, explain: 'I en lydhastighetsprofil som bare varierer med dybden, er ray parameteren bevart langs strålen.' },
      { question: 'Hva skjer med den lokale strålevinkelen dersom lydhastigheten øker langs strålen?', options: ['Vinkelen øker, gitt at p er konstant', 'Vinkelen synker alltid', 'Vinkelen endres ikke'], answer: 0, explain: 'Fra p = sin(θ)/c må sin(θ) øke når c øker, så strålen øker vinkelen fra vertikalen.' },
      { question: 'Hvilken virkning har en negativ lydhastighetsgradient?', options: ['Lyden bøyes oppover', 'Lyden bøyes nedover', 'Lyden stopper ved havbunnen'], answer: 1, explain: 'Med negativ gradient synker lydhastigheten med dybden, og strålen bøyes nedover.' },
      { question: 'Hva må et multistråleekkolodd koble sammen for å beregne posisjon og dybde?', options: ['Temperatur og saltinnhold', 'Reisetid og modellert strålegang', 'Bare horisontal avstand'], answer: 1, explain: 'Reisetiden og den beregnede strålegangen fra SSP-en brukes til å finne hvert bunntreff.' },
      { question: 'Hvordan brukes tur-retur-tiden i den multistrålebaserte dybdemålingen?', options: ['Den deles på to før posisjonen beregnes', 'Den multipliseres med frekvensen', 'Den brukes bare til å måle temperatur'], answer: 0, explain: 'Lyden går tur-retur, så strålegang og posisjon beregnes med tiden i én retning.' },
      { question: 'Hva kalles systematiske bunnavvik som følger stråleviften dersom SSP-en er feil?', options: ['Smilende eller sur havbunn', 'Overflateresonanser', 'Akustiske nullpunkter'], answer: 0, explain: 'Feil modellert strålegang kan forvrenge det beregnede flatbunnskartet til et smil eller en sur munn.' },
      { question: 'Hva er den viktigste fordelen ved å plassere sonaren i en lydkanal?', options: ['Lyden løper langs havbunnen uten dB-tap', 'Strålene holdes samlet, så det geometriske tapet er mindre', 'Sonaren ligger mer stabilt'], answer: 1, explain: 'I en lydkanal bøyes strålene mot området med lavest lydhastighet, slik at lyden holdes samlet over større avstander.' },
    ]

  return <LanguageContext.Provider value={language}>{localizeTree((
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="Hydroakustikk feltlab, til toppen"><img className="usn-logo" src="/usn-logo.svg" alt="Universitetet i Sørøst-Norge" /><span className="brand-separator" /><span className="top-app-brand"><span className="brand-mark"><AudioLines size={19} /></span><span>HAV<span className="brand-light"> / LAB</span></span></span></a>
        <nav className="top-links" aria-label="Hovednavigasjon"><a href="#propagation">Læreverket</a><a href="#simulator">Simulator</a><a href="#quiz">Oppgaver</a></nav>
        <div className="language-toggle" role="group" aria-label="Velg språk">
          <button type="button" aria-pressed={language === 'no'} onClick={() => setLanguage('no')}>NO</button>
          <button type="button" aria-pressed={language === 'en'} onClick={() => setLanguage('en')}>EN</button>
        </div>
        <div className="top-meta"><span className="live-dot" /> UNDERVISNINGSRESSURS <span className="meta-divider" /> MBES · 01</div>
      </header>

      <main id="top">
        <section className="hero">
          <div className="hero-inner">
            <div className="hero-copy">
              <motion.div className="hero-kicker" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.55 }}><span className="kicker-line" /> {language === 'en' ? 'DIGITAL FIELD LAB · HYDROACOUSTICS' : 'DIGITALT FELTLAB · HYDROAKUSTIKK'}</motion.div>
              <motion.h1 initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.65, delay: 0.1 }}>{language === 'en' ? 'Understand how sound travels through the sea' : 'Forstå lydens ferd gjennom havet'}</motion.h1>
              <motion.p className="hero-intro" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.6, delay: 0.25 }}>{language === 'en' ? 'From wave physics to acoustic measurements. Explore how sound speed affects every measurement.' : 'Fra bølgefysikk til akustisk måling. Utforsk hvordan lydhastigheten påvirker hver eneste måling.'}</motion.p>
              <motion.div className="hero-actions" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.4 }}><a className="button-primary" href="#propagation">{language === 'en' ? 'Start the learning resource' : 'Start læreverket'} <ArrowDown size={16} /></a><span className="hero-duration"><Activity size={15} /> {language === 'en' ? '9 modules' : '9 moduler'} <span>·</span> 20 min</span></motion.div>
            </div>
            <motion.div className="hero-art" initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.8, delay: 0.1 }} aria-hidden="true">
              <div className="art-coordinate">N 60° 23′ 48″<br />E 05° 19′ 12″</div>
              <svg viewBox="0 0 600 430" role="presentation" className="sound-art">
                <defs><linearGradient id="sea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#eee7f5" stopOpacity=".6"/><stop offset="1" stopColor="#f5f0f9" stopOpacity=".04"/></linearGradient><linearGradient id="beam" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#7800f0" stopOpacity=".28"/><stop offset="1" stopColor="#7800f0" stopOpacity=".02"/></linearGradient></defs>
                <path d="M0 0H600V430H0z" fill="url(#sea)"/><path d="M0 300 Q70 286 130 303 T260 295 T390 310 T520 291 T600 301 V430 H0z" fill="#dbe4da"/>
                <path d={fanAreaPath} fill="url(#beam)"/><path d="M0 190h600M0 230h600M0 270h600" stroke="#96aa9e" strokeOpacity=".23" strokeDasharray="2 7"/>
                <path d="M0 80 Q15 76 30 80 T60 80 T90 80 T120 80 T150 80 T180 80 T210 80 T240 80 T270 80 T300 80 T330 80 T360 80 T390 80 T420 80 T450 80 T480 80 T510 80 T540 80 T570 80 T600 80" fill="none" stroke="#3976b8" strokeWidth="2.5"/>
                <path d="M0 300 Q70 286 130 303 T260 295 T390 310 T520 291 T600 301" fill="none" stroke="#74877c" strokeWidth="2"/>
                <g fill="none" stroke="#7800f0" strokeWidth="1.5" strokeDasharray="5 6">{beamRays.map((point, index) => <path key={index} d={`M300 80L${point.x.toFixed(2)} ${point.y.toFixed(2)}`} />)}</g><g fill="#3976b8" stroke="#fff" strokeWidth="1.5">{beamRays.map((point, index) => <circle key={index} cx={point.x} cy={point.y} r="4" />)}</g>
                <g>
                  <path d="M246 63H356L338 77Q300 83 262 77Z" fill="#18332c"/>
                  <path d="M254 69H348" fill="none" stroke="#dfeee6" strokeWidth="2" opacity=".8"/>
                  <path d="M270 63V57H281V63Z" fill="#18332c"/>
                  <path d="M281 63V48L290 39H319L328 48V63Z" fill="#18332c"/>
                  <path d="M288 49H298V57H288ZM301 49H311V57H301ZM314 49H322V57H314Z" fill="#dfeee6"/>
                  <path d="M286 47H324M305 39V30M301 32H309" fill="none" stroke="#18332c" strokeWidth="2"/>
                </g>
                <path d="M300 80v3" fill="none" stroke="#18332c" strokeWidth="1.5"/>
                <path d="M293 80a7 7 0 0 0 14 0z" fill="#3976b8" fillOpacity=".72" stroke="#3976b8" strokeWidth="2"/>
              </svg>
            </motion.div>
          </div>
          <div className="hero-bottom"><span>01 — 10 <span className="hero-bottom-rule" /> GRUNNPRINSIPPER</span><span>MARIN AKUSTIKK <span className="hero-bottom-rule" /> INTERAKTIVT LÆRINGSROM</span></div>
        </section>

        <nav className="chapter-nav" aria-label="Kapitler"><div className="chapter-nav-inner"><span className="chapter-label">KAPITLER</span>{sectionLinks.map(([id, label], index) => <a key={id} href={`#${id}`}><span>{String(index + 1).padStart(2, '0')}</span>{label}</a>)}</div></nav>

        <section id="propagation" className="lesson-section">
          <SectionHeading number="01" eyebrow="BØLGEFYSIKK" title="Lydforplantning beskrevet ved strålegang" />
          <div className="lesson-grid">
            <div className="lesson-copy"><p>Lyd er mekaniske trykkforstyrrelser som beveger seg gjennom et medium. Vi kan beskrive bevegelsen geometrisk ved hjelp av stråler. Strålene står normalt på bølgefrontene. Avstanden <strong>λ</strong> er mellom hver bølgefront, og de viser hvor trykket når sitt maksimum.</p><Formula math="c = f\lambda" /><p className="definition-line"><strong>c</strong> lydhastighet · <strong>f</strong> frekvens · <strong>λ</strong> bølgelengde</p><p>Frekvensen bestemmer hvor raskt trykket svinger. For en gitt lydhastighet gir høyere frekvens kortere bølgelengde. I sjøvann beveger lyd seg typisk med omtrent 1500 m/s.</p><div className="concept-list"><span><i className="concept-dot green" /> Trykkbølge</span><span><i className="concept-dot blue" /> Utbredelsesretning</span><span><i className="concept-dot coral" /> Bølgefront</span></div><TrySelfBox norwegian={'Endre frekvensen og hold lydhastigheten konstant. Hvordan endres bølgelengden, og hvordan ser dette ut i bølgefrontene? Øk deretter maksimal avstand og undersøk om stråletubenes tverrsnitt gjør at lydintensiteten avtar som forklart i teorien.'} english={'Change the frequency while keeping the sound speed constant. How does the wavelength change, and how does this appear in the wavefronts? Then increase the maximum range and examine whether the cross-sectional areas of the ray tubes cause the sound intensity to decrease as described by the theory.'} /></div>
            <ModuleFrame label="01.1 · BØLGEFRONT" title="Frekvens og bølgelengde">
              <div className="chart-area wave-chart"><Chart data={waveTraces} layout={waveLayout} /></div>
              <div className="module-controls"><div className="paired-sliders"><Slider label="Frekvens" value={frequency} min={1000} max={100000} step={1000} unit="Hz" onChange={setFrequency} marks={['1 kHz', '100 kHz']} /><Slider label="Lydhastighet" value={soundSpeed} min={1300} max={1700} step={1} unit="m/s" onChange={setSoundSpeed} marks={['1300 m/s', '1700 m/s']} /></div><Slider label="Maksavstand" value={maxPlotDistance} min={0.1} max={5} step={0.1} unit="m" onChange={setMaxPlotDistance} marks={['0,1 m', '5 m']} /><div className="readout-row"><span>LYDHASTIGHET <strong>{soundSpeed} m/s</strong></span><span>BØLGELENGDE <strong>{fmt(wavelength * 100, 2, numberLocale)} cm</strong></span></div></div>
            </ModuleFrame>
          </div>
          <div className="lesson-grid ray-tube-grid">
            <RayTubeDiagram />
          <div className="lesson-copy"><p>{language === 'en'
            ? 'The space between neighboring rays is called a ray tube; when the cross-sectional area increases, sound intensity decreases in inverse proportion. By comparing the cross-sectional area at different positions, we can calculate the geometric loss up to a given position.'
            : 'Rommet mellom nabostråler kalles en stråletube; når tverrsnittsarealet øker, avtar lydintensiteten omvendt proporsjonalt. Ved å sammenligne tverrsnittsarealet ved ulike posisjoner kan vi beregne det geometriske tapet fram til en gitt posisjon.'}</p><Formula math="I \propto \frac{1}{A}" /><p><strong>I</strong> {language === 'en' ? 'is sound intensity, and' : 'er lydintensiteten, og'} <strong>A</strong> {language === 'en' ? 'is the cross-sectional area of the ray tube.' : 'er stråletubens tverrsnittsareal.'}</p></div>
          </div>
        </section>

        <section id="reflection" className="lesson-section section-tint">
          <SectionHeading number="02" eyebrow="GRENSEFLATER" title="Refleksjon av lyd" description="Når en akustisk bølge treffer en grenseflate, reflekteres en del av energien. Innfallsvinkelen er lik refleksjonsvinkelen, målt fra normalen." />
          <div className="lesson-grid reverse-mobile">
            <ModuleFrame label="02.1 · SPEILREFLEKSJON" title="Vinkel inn = vinkel ut"><div className="chart-area reflection-chart"><Chart data={reflectionTraces} layout={{ xaxis: { title: 'Horisontal avstand (m)', range: [-10, 10], zeroline: false }, yaxis: { title: 'Dybde (m)', range: [-2, 8], scaleanchor: 'x', scaleratio: 0.7 }, legend: { orientation: 'h', y: 1.12 } }} /></div><div className="module-controls"><Slider label="Innfallsvinkel θᵢ" value={reflectionAngle} min={5} max={75} step={1} unit="°" onChange={setReflectionAngle} marks={['5°', '75°']} /><div className="readout-row"><span>INNFALL θᵢ <strong>{reflectionAngle}°</strong></span><span>REFLEKSJON θᵣ <strong>{reflectionAngle}°</strong></span></div></div></ModuleFrame>
            <div className="lesson-copy reflection-copy"><Formula math="\theta_i = \theta_r" /><p>Vinklene måles fra <strong>normalen</strong>, en tenkt linje vinkelrett på havbunnen ved treffpunktet. Ikke fra selve bunnen.</p><div className="definition-cards"><div><span className="tiny-number">A</span><strong>Innfallsvinkel</strong><p>Vinkel mellom innkommende stråle og normal.</p></div><div><span className="tiny-number">B</span><strong>Normal</strong><p>Vinkelrett referanselinje i treffpunktet.</p></div><div><span className="tiny-number">C</span><strong>Refleksjonsvinkel</strong><p>Vinkel mellom reflektert stråle og normal.</p></div></div><TrySelfBox norwegian={'Endre innfallsvinkelen og se hvilken sammenheng som gjelder for refleksjonsvinkelen.'} english={'Change the angle of incidence and observe the relationship that governs the reflection angle.'} /></div>
          </div>
        </section>

        <section id="snell" className="lesson-section">
          <SectionHeading number="03" eyebrow="LYDHASTIGHET OG VINKEL" title="Brytning av lyd" description="Når lyd passerer mellom vannlag med ulik lydhastighet, endrer strålen retning. Snells lov kobler lydhastigheten i hvert lag til strålevinkelen." />
          <div className="lesson-grid">
            <div className="lesson-copy"><Formula math="\frac{\sin\theta_1}{c_1} = \frac{\sin\theta_2}{c_2}" /><p>Vinkelen måles fra normalen til laggrensen. Strålen bøyes <strong>bort fra normalen</strong> når lydhastigheten øker, og mot normalen når den avtar.</p><CardNote>{totalReflection
              ? (language === 'en'
                ? 'For these values, there is no real refraction angle: the angle of incidence exceeds the critical angle, and the ray undergoes total internal reflection.'
                : 'For disse verdiene finnes ingen reell brytningsvinkel: innfallsvinkelen overstiger kritisk vinkel, og strålen totalreflekteres.')
              : (language === 'en'
                ? <>The ray bends {c2 > c1 ? 'away from' : c2 < c1 ? 'toward' : 'neither toward nor away from'} the normal in the faster layer.</>
                : <>Strålen brytes {c2 > c1 ? 'bort fra' : c2 < c1 ? 'mot' : 'ikke i forhold til'} normalen i det raskere laget.</>)}</CardNote><LearningNote items={['Lav innfallsvinkel gir liten retningsendring.', 'Større forskjell i lydhastighet gir større brytning.', 'Strålene bøyes mot lavere lydhastighet. Tommelfingerregel: Lyden er lat.']} /><TrySelfBox norwegian={'Prøv et sakte og et raskt vannlag i begge retninger. Hvordan endrer strålen retning når lydhastigheten øker eller avtar, og hvor stor må innfallsvinkelen være før totalrefleksjon oppstår?'} english={'Try a slow and a fast water layer in both directions. How does the ray change direction as sound speed increases or decreases, and how large must the angle of incidence be before total reflection occurs?'} /></div>
            <ModuleFrame label="03.1 · TO VANNLAG" title="Snells lov i praksis"><div className="chart-area snell-chart"><Chart data={[
              { x: [-5 * Math.sin((snellAngle * Math.PI) / 180), 0], y: [-5 * Math.cos((snellAngle * Math.PI) / 180), 0], mode: 'lines', name: 'Innkommende', line: { color: colors.red, width: 3 } },
              totalReflection ? { x: [0, 5 * Math.sin((snellAngle * Math.PI) / 180)], y: [0, -5 * Math.cos((snellAngle * Math.PI) / 180)], mode: 'lines', name: 'Totalrefleksjon', line: { color: colors.blue, width: 3, dash: 'dash' } } : { x: [0, 7 * Math.tan((refractedAngle * Math.PI) / 180)], y: [0, 7], mode: 'lines', name: 'Brutt stråle', line: { color: colors.blue, width: 3 } },
              { x: [-8, 8], y: [0, 0], mode: 'lines', name: 'Grenseflate', line: { color: '#899a91', width: 2 } },
            ]} layout={{ xaxis: { title: 'Horisontal avstand', range: [-8, 8] }, yaxis: { title: 'Dybde', range: [7, -5], scaleanchor: 'x', scaleratio: 1 }, legend: { orientation: 'h', y: 1.12 } }} /></div><div className="module-controls"><div className="paired-sliders"><Slider label="Lydhastighet c₁" value={c1} min={1400} max={1600} step={1} unit="m/s" onChange={setC1} /><Slider label="Lydhastighet c₂" value={c2} min={1400} max={1600} step={1} unit="m/s" onChange={setC2} /></div><Slider label="Innfallsvinkel θ₁" value={snellAngle} min={5} max={75} step={1} unit="°" onChange={setSnellAngle} /><div className="readout-row"><span>BRYTNINGSVINKEL <strong>{totalReflection ? 'Totalrefleksjon' : `${fmt(refractedAngle, 1)}°`}</strong></span><span>LYDHASTIGHET <strong>{c1} → {c2} m/s</strong></span></div></div></ModuleFrame>
          </div>
        </section>

        <section id="reflection-coefficient" className="lesson-section section-tint">
          <SectionHeading number="04" eyebrow="GRENSEFLATER" title="Refleksjonskoeffisient" description="Hvor mye lydenergi som reflekteres eller transmitteres, avhenger av egenskapene til mediene og innfallsvinkelen." />
          <div className="seabed-properties-table">
            <div className="table-heading">
              <span className="eyebrow">04.1 · TYPISKE VERDIER</span>
              <h3>Typiske egenskaper for havbunnen</h3>
            </div>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Materiale</th>
                    <th scope="col">Tetthet (kg/m³)</th>
                    <th scope="col">Lydhastighet (m/s)</th>
                  </tr>
                </thead>
                <tbody>
                  <tr><th scope="row">Sjøvann</th><td>1025</td><td>1500</td></tr>
                  <tr><th scope="row">Sand (vannmettet)</th><td>1900–2200</td><td>1650–1800</td></tr>
                  <tr><th scope="row">Silt/leire, vannmettet</th><td>1300–1700</td><td>1450–1600</td></tr>
                  <tr><th scope="row">Stein (sedimentært)</th><td>2200–2800</td><td>2500–4500</td></tr>
                  <tr><th scope="row">Stein (magmatisk, f.eks. granitt)</th><td>2600–3000</td><td>4500–6000</td></tr>
                </tbody>
              </table>
            </div>
          </div>
          <div className="lesson-grid transmission-grid">
            <div className="lesson-copy transmission-copy">
              <Formula math="R_p=\frac{Z_2\cos\theta_i-Z_1\cos\theta_t}{Z_2\cos\theta_i+Z_1\cos\theta_t}" />
              <p>{language === 'en'
                ? <><strong>R<sub>p</sub></strong> is the pressure reflection coefficient. Here, <strong>Z₁ = ρ₁c₁</strong> and <strong>Z₂ = ρ₂c₂</strong> are the acoustic impedances of the two media, while θᵢ and θₜ are the angle of incidence and the refraction angle, measured from the normal. The reflected and transmitted intensity fractions are <strong>R<sub>I</sub> = R<sub>p</sub><sup>2</sup></strong> and <strong>T<sub>I</sub> = 1 − R<sub>I</sub></strong>, respectively, so <strong>R<sub>I</sub> + T<sub>I</sub> = 1</strong>.</>
                : <><strong>R<sub>p</sub></strong> er trykk-refleksjonskoeffisienten. Her er <strong>Z₁ = ρ₁c₁</strong> og <strong>Z₂ = ρ₂c₂</strong> de akustiske impedansene i de to mediene, mens θᵢ og θₜ er henholdsvis innfallsvinkelen og brytningsvinkelen målt fra normalen. Reflektert og transmittert intensitetsandel er henholdsvis <strong>R<sub>I</sub> = R<sub>p</sub><sup>2</sup></strong> og <strong>T<sub>I</sub> = 1 − R<sub>I</sub></strong>, slik at <strong>R<sub>I</sub> + T<sub>I</sub> = 1</strong>.</>}</p>
              <Formula math="BL=-10\log_{10}(R_I)" />
              <p>{language === 'en'
                ? <><strong>Bottom loss</strong> is given in dB as <strong>−10 log₁₀(R<sub>I</sub>)</strong>. When the reflection coefficient is large, bottom loss is low; when less energy is reflected, bottom loss increases. The size and direction of the transmitted and reflected arrows therefore change together with bottom loss.</>
                : <><strong>Bunntap</strong> (bottom loss) er gitt i dB som <strong>−10 log₁₀(R<sub>I</sub>)</strong>. Når refleksjonskoeffisienten er stor, er bunntapet lavt; og når mindre av energien reflekteres, blir bunntapet større. Størrelsen og retningen på de transmitterte og reflekterte pilene endres derfor sammen med bunntapet.</>}</p>
              <CardNote>Pilenes tykkelse viser intensiteten: tykke piler betyr mye av den innfallende energien, og tynnere piler betyr mindre.</CardNote>
              <TrySelfBox norwegian={'Hvilken betydning har beskaffenheten av bunn for refleksjons- og transmisjonskoeffisientene? Prøv ulike lydhastigheter og tettheter og reflekter over både totalrefleksjonsvinkelen og fordelingen mellom reflektert og transmittert intensitet. Hva skjer hvis bunnen har de samme egenskapene som sjøvannet? Hva skjer hvis du nå endrer tettheten? Reflekter over hvilken betydningen dette har for bunndetekterende sonarer (f.eks. multistråleekkolodd).'} english={'How does the character of the seafloor affect the reflection and transmission coefficients? Try different sound speeds and densities, and consider both the critical angle and the distribution between reflected and transmitted intensity. What happens if the bottom has the same properties as seawater? What happens if you then change the density? Reflect on what this means for bottom-detecting sonars (for example, multibeam echosounders).'} />
            </div>
            <ModuleFrame label="04.1 · TRANSMISJON" title="Utforsk refleksjon og transmisjon">
              <div className="chart-area transmission-chart"><Chart data={transmissionTraces} layout={{ xaxis: { title: 'Horisontal avstand (m)', range: [-10, 10], zeroline: false }, yaxis: { title: 'Loddrett avstand (m)', range: [-9, 9], scaleanchor: 'x', scaleratio: 1 }, legend: { orientation: 'h', y: 1.12 } }} /></div>
              <div id="transmission-intensity" className="chart-area transmission-intensity-chart">
                <Chart
                  data={transmissionIntensityTraces}
                  layout={{
                    margin: { l: 48, r: 18, t: 42, b: 48 },
                    xaxis: { title: language === 'en' ? 'Angle of incidence θᵢ (°)' : 'Innfallsvinkel θᵢ (°)', range: [0, 90], tickmode: 'linear', dtick: 15, zeroline: false },
                    yaxis: { title: language === 'en' ? 'Intensity (%)' : 'Intensitet (%)', range: [0, 105], ticksuffix: ' %', zeroline: true },
                    legend: { orientation: 'h', y: 1.14 },
                    shapes: [
                      ...(cMedium2 > cMedium1 ? [{
                        type: 'line' as const,
                        x0: Math.asin(cMedium1 / cMedium2) * 180 / Math.PI,
                        x1: Math.asin(cMedium1 / cMedium2) * 180 / Math.PI,
                        y0: 0,
                        y1: 105,
                        line: { color: '#28252c', width: 1.5, dash: 'dot' },
                      }] : []),
                      {
                        type: 'line' as const,
                        x0: transmissionAngle,
                        x1: transmissionAngle,
                        y0: 0,
                        y1: 105,
                        line: { color: colors.red, width: 2, dash: 'dash' },
                      },
                    ],
                    annotations: [
                      ...(cMedium2 > cMedium1 ? [{
                        x: Math.asin(cMedium1 / cMedium2) * 180 / Math.PI,
                        y: 96,
                        xref: 'x' as const,
                        yref: 'y' as const,
                        text: language === 'en'
                          ? `Critical angle<br>${fmt(Math.asin(cMedium1 / cMedium2) * 180 / Math.PI, 1)}°`
                          : `Totalrefleksjonsvinkel<br>${fmt(Math.asin(cMedium1 / cMedium2) * 180 / Math.PI, 1)}°`,
                        showarrow: false,
                        xshift: 8,
                        yshift: 0,
                        bgcolor: 'rgba(255,255,255,0.92)',
                        bordercolor: '#28252c',
                        borderwidth: 1,
                        font: { size: 9, color: '#28252c' },
                        align: 'left' as const,
                      }] : []),
                      {
                        x: transmissionAngle,
                        y: 88,
                        xref: 'x' as const,
                        yref: 'y' as const,
                        text: language === 'en' ? `Selected: ${transmissionAngle}°` : `Valgt: ${transmissionAngle}°`,
                        showarrow: false,
                        xshift: transmissionAngle > 78 ? -8 : 8,
                        bgcolor: 'rgba(219,101,79,0.10)',
                        bordercolor: colors.red,
                        borderwidth: 1,
                        font: { size: 9, color: '#a44c3d' },
                      },
                    ],
                  }}
                />
              </div>
              <div className="module-controls transmission-controls">
                <div className="paired-sliders">
                  <Slider label="Medium 1 · lydhastighet c₁" value={cMedium1} min={1200} max={2500} step={10} unit="m/s" onChange={setCMedium1} marks={['1200 m/s', '2500 m/s']} />
                  <Slider label="Medium 1 · tetthet ρ₁" value={rhoMedium1} min={800} max={2200} step={10} unit="kg/m³" onChange={setRhoMedium1} marks={['800 kg/m³', '2200 kg/m³']} />
                </div>
                <div className="paired-sliders">
                  <Slider label="Medium 2 · lydhastighet c₂" value={cMedium2} min={1200} max={2500} step={10} unit="m/s" onChange={setCMedium2} marks={['1200 m/s', '2500 m/s']} />
                  <Slider label="Medium 2 · tetthet ρ₂" value={rhoMedium2} min={800} max={2200} step={10} unit="kg/m³" onChange={setRhoMedium2} marks={['800 kg/m³', '2200 kg/m³']} />
                </div>
                <Slider label="Innfallsvinkel θᵢ" value={transmissionAngle} min={0} max={75} step={1} unit="°" onChange={setTransmissionAngle} marks={['0°', '75°']} />
                <div className="readout-row transmission-readouts">
                  <span>REFLEKSJONSKOEFFISIENT R<sub>I</sub><strong>{fmt(transmissionResult.reflectionIntensity * 100, 1)}%</strong></span>
                  <span>TRANSMISJON T<sub>I</sub><strong>{fmt(transmissionResult.transmissionIntensity * 100, 1)}%</strong></span>
                  <span>BUNNTAP BL<strong>{transmissionResult.bottomLoss > 59 ? '> 60 dB' : `${fmt(transmissionResult.bottomLoss, 1)} dB`}</strong></span>
                  <span>BRYTNINGSVINKEL θₜ<strong>{transmissionResult.totalInternalReflection ? 'Totalrefleksjon' : `${fmt(transmissionResult.transmitted * 180 / Math.PI, 1)}°`}</strong></span>
                </div>
              </div>
            </ModuleFrame>
          </div>
        </section>

        <section id="invariant" className="lesson-section section-tint">
          <SectionHeading number="05" eyebrow="BEVART STØRRELSE" title="Ray parameter og stråleinvarianten" description="I et horisontalt lagdelt hav er lydhastigheten bare en funksjon av dybde. Da er ray parameter konstant langs strålen, selv om både hastighet og vinkel endres." />
          <div className="invariant-intro"><div className="invariant-formula"><Formula math={`p = \\frac{\\sin\\theta}{c} = \\text{${language === 'en' ? 'constant' : 'konstant'}}`} /></div><div className="invariant-explain"><p><strong>p</strong> beskriver strålens horisontale slakhet, <strong>θ</strong> er vinkelen fra vertikalen, og <strong>c</strong> er lokal lydhastighet. Når c øker langs strålen, må θ øke for at p skal bevares.</p><TrySelfBox norwegian={'Typisk lydhastighetsgradient på dypt vann i havet er ca 0.05 m/s/m. Finn den høyeste utsendte vinkelen som resulterer i en stråle som bøyes av mot overflaten på ca 50 km.'} english={'A typical sound-speed gradient in deep ocean water is approximately 0.05 m/s/m. Find the highest launch angle that produces a ray which turns back toward the surface at approximately 50 km.'} /></div></div>
          <LearningNote items={['Positiv gradient bøyer lyden oppover.', 'Negativ gradient bøyer lyden nedover.', 'Er den positive gradienten stor nok, når strålen et vendepunkt og brytes tilbake mot overflaten uten å treffe havbunnen.']} />
          <div className="sim-grid two-up">
            <ModuleFrame label="05.1 · STRÅLE OG SSP" title="Følg strålen gjennom profilen"><div className="invariant-plots"><div className="chart-area invariant-speed-chart"><Chart data={speedProfileTraces} layout={{ margin: { l: 48, r: 12, t: 42, b: 70 }, xaxis: { range: [Math.min(...invariantSpeedRange) - 10, Math.max(...invariantSpeedRange) + 10] }, yaxis: { title: 'Dybde (m)', range: [rayProfileDepth, 0] }, annotations: [{ text: 'Lydhastighet', xref: 'paper', yref: 'paper', x: 0.5, y: 1.15, showarrow: false }], showlegend: false }} /></div><div className="chart-area invariant-ray-chart"><Chart data={rayProfileTraces} onHover={(event) => { const point = event.points.find((item) => Number.isFinite(item.x)); if (point) setHoverPoint({ x: point.x, z: point.y }) }} layout={{ margin: { l: 48, r: 12, t: 42, b: 70 }, xaxis: { title: 'Avstand (km)', range: [0, 50], tickmode: 'linear', dtick: 10 }, yaxis: { title: 'Dybde (m)', range: [rayProfileDepth, 0] }, legend: { orientation: 'h', y: 1.16 } }} /></div></div><div className="module-controls"><div className="paired-sliders"><Slider label="Utsendt vinkel" value={rayAngle} min={5} max={90} step={1} unit="°" onChange={setRayAngle} marks={['5°', '90°']} /><Slider label="Lydhastighetsgradient" value={rayGradient} min={-0.05} max={0.05} step={0.001} unit="m/s/m" onChange={setRayGradient} marks={['−0,05', '+0,05']} /></div><CardNote>{invariantRay.turned ? 'Strålen har nådd et vendepunkt og bøyes tilbake mot overflaten.' : 'Øk den positive gradienten eller utsendte vinkelen for å se strålen nå et vendepunkt.'}</CardNote></div></ModuleFrame>
            <ModuleFrame label="05.2 · LOKAL TILSTAND" title="Verdier langs strålen"><div className="readout-stack"><div className="position-readouts"><div className="large-readout"><span>DYBDE</span><strong>{fmt(hoverPoint.z, 1)}<small> m</small></strong><i>Posisjon langs strålen</i></div><div className="large-readout"><span>AVSTAND</span><strong>{fmt(hoverPoint.x, 2)}<small> km</small></strong><i>Fra lydkilden</i></div></div><div className="readout-mini-grid"><div><span>LYDHASTIGHET</span><strong>{fmt(currentSpeed, 1)} <small>m/s</small></strong></div><div><span>LOKAL VINKEL θ</span><strong>{fmt(currentAngle, 2)} <small>°</small></strong></div><div><span>RAY PARAMETER p</span><strong>{currentP.toExponential(3)} <small>s/m</small></strong></div></div><CardNote>Beveg pekeren over strålen for å lese av tilstand ved dybden. I et lagdelt hav holdes p tilnærmet konstant.</CardNote></div></ModuleFrame>
          </div>
        </section>

        <section id="errors" className="lesson-section">
          <SectionHeading
            number="06"
            eyebrow="USIKKERHET OG KONSEKVENS"
            title="Hvorfor lydhastighetsprofiler er kritiske"
            description={language === 'en'
              ? 'An incorrect estimate of sound speed produces an incorrect modeled ray path. The following explains how such an error affects bathymetric measurements with a multibeam echosounder. The error systematically shifts the calculated seafloor point across the beam fan.'
              : 'Et feil estimat av lydhastigheten gir feil modellert strålegang. Herunder følger en forklaring på hvilken betydning en slik feil har for bånnoppmåling med et multistråleekkolodd. Feilen flytter det beregnede bunnpunktet systematisk på tvers av stråleviften.'}
          />
          <SeafloorErrorDiagram />
          <div className="error-comparison"><div className="comparison-visual"><div className="comparison-header"><span>SSP OG BUNNFORM</span><span className="comparison-legend"><i className="legend-dot red" /> Sann <i className="legend-dot blue" /> Beregnet</span></div><svg viewBox="0 0 840 290" aria-label="Sammenligning mellom korrekt SSP og feil SSP som gir smilende og sur havbunn"><defs><pattern id="grid" width="42" height="29" patternUnits="userSpaceOnUse"><path d="M42 0H0V29" fill="none" stroke="#e5eae4" strokeWidth="1" /></pattern></defs><rect x="40" y="20" width="760" height="230" fill="url(#grid)"/><path d="M80 55V190Q420 190 760 55" fill="none" stroke="#db654f" strokeWidth="3"/><path d="M80 67V180Q420 180 760 67" fill="none" stroke="#3976b8" strokeWidth="2.5" strokeDasharray="8 6"/><path d="M80 55V190Q420 190 760 55" fill="none" stroke="#db654f" strokeWidth="2" opacity=".35"/><path d="M80 55L420 118L760 55" fill="none" stroke="#3976b8" strokeWidth="2.5" strokeDasharray="8 6"/><path d="M220 190Q420 244 620 190" fill="none" stroke="#db654f" strokeWidth="2"/><path d="M220 180Q420 155 620 180" fill="none" stroke="#3976b8" strokeWidth="2.5" strokeDasharray="8 6"/><text x="410" y="34" textAnchor="middle">KORREKT SSP · RIKTIG STRÅLEGANG</text><text x="410" y="278" textAnchor="middle">FEIL SSP · POSISJONSFEIL PÅVIRKER BUNNKARTET</text><text x="103" y="215">SMILENDE</text><text x="690" y="215">SUR</text><text x="120" y="92">✓</text><text x="711" y="97">!</text></svg></div><div className="comparison-copy"><div><span className="comparison-tag">KORREKT SSP</span><h3>Riktig strålebane</h3><p>Vannprofilen beskriver lydhastigheten i vannsøylen godt. Beregnet bunnpunkt samsvarer med faktisk treff.</p></div><div><span className="comparison-tag wrong">FEIL SSP</span><h3>Feil havbunnsform</h3><p>Systematiske feil i stråleviften kan gi <strong>smilende</strong> eller <strong>sur</strong> bunn i kartet, avhengig av profilavviket.</p></div><a className="text-link" href="#simulator">Se effekten i simulatoren <ArrowRight size={15} /></a></div></div>
        </section>

        <section id="simulator" className="simulator-section">
          <div className="simulator-inner"><div className="simulator-head"><div><span className="eyebrow"><span className="live-dot" /> PRAKTISK ØVELSE · 07</span><h2>Hva skjer når SSPen er feil?</h2></div><div className="simulator-badge"><Waves size={16} /> NUMERISK RAY TRACING <span>Δz = 0,02 m</span></div></div>
            <TrySelfBox
              norwegian={'Sett sann og målt SSP-gradient lik, og deretter ulike. Sammenlign strålebanene, feilmålingenes størrelse og formen på den rekonstruerte havbunnen. Prøv både positive og negative, store og små avvik.'}
              english={'Set the true and measured SSP gradients equal, then make them differ. Compare the ray paths, error metrics, and shape of the reconstructed seafloor. Try both positive and negative differences, as well as large and small deviations.'}
            />
            <div className="simulator-controls"><div className="gradient-control"><div className="gradient-control-copy"><span className="eyebrow">SANN OG MÅLT SSP</span><h3>Juster lydhastighetsgradientene</h3><p>Den sanne gradienten styrer ekkoet. Den målte gradienten brukes til å rekonstruere treffpunktet.</p></div><div className="gradient-control-input"><div className="paired-sliders"><Slider label="Sann SSP · gradient g" value={draftGradient} min={SSP_GRADIENT_MIN} max={SSP_GRADIENT_MAX} step={SSP_GRADIENT_STEP} unit="m/s/m" marks={['−0,5', '+0,5']} onChange={setDraftGradient} onCommit={commitGradient} /><Slider label="Målt SSP · gradient g" value={draftMeasuredGradient} min={SSP_GRADIENT_MIN} max={SSP_GRADIENT_MAX} step={SSP_GRADIENT_STEP} unit="m/s/m" marks={['−0,5', '+0,5']} onChange={setDraftMeasuredGradient} onCommit={(value) => { setDraftMeasuredGradient(value); setAppliedMeasuredGradient(value) }} /></div><div className="gradient-slider-foot"><span>{language === 'en' ? 'True' : 'Sann'}: c(z) = {SURFACE_SPEED} + gₛ · z</span><span>{language === 'en' ? 'Measured' : 'Målt'}: c(z) = {SURFACE_SPEED} + gₘ · z</span><button className="reset-button" onClick={() => commitGradient(0)} aria-label="Nullstill sann SSP-gradient"><RotateCcw size={14} /> Nullstill sann gradient</button></div></div></div><div className="metrics-strip"><div><span>MAKS. DYBDEFEIL</span><strong>{fmt(metrics.max, 2)}<small> m</small></strong></div><div><span>GJENNOMSNITTLIG FEIL</span><strong>{fmt(metrics.mean, 2)}<small> m</small></strong></div><div><span>RMS-FEIL</span><strong>{fmt(metrics.rms, 2)}<small> m</small></strong></div><div><span>YTTERSTE STRÅLER</span><strong>{fmt(metrics.outer, 2)}<small> m</small></strong></div></div></div>
            <div className="sim-panels"><ModuleFrame label="PANEL 01 · ±60° / 5°" title="Strålegang"><div className="chart-area simulator-plot"><Chart id="ray-plot" data={rayTraces} layout={{ margin: { l: 47, r: 8, t: 24, b: 38 }, xaxis: { title: 'Avstand (m)' }, yaxis: { title: 'Dybde (m)', range: [110, -5] }, showlegend: true, legend: { orientation: 'h', y: 1.15, font: { size: 9 } } }} /></div><div className="panel-foot"><span><i className="legend-dot red" /> Sann stråle</span><span><i className="legend-dot blue dashed" /> Rekonstruert</span></div></ModuleFrame>
              <ModuleFrame label="PANEL 02 · c(z)" title="Lydhastighetsprofiler"><div className="chart-area simulator-plot"><Chart id="profile-plot" data={simulatorProfile} layout={{ margin: { l: 48, r: 8, t: 24, b: 38 }, xaxis: { title: 'Lydhastighet (m/s)', range: [Math.min(...simulatorSpeedRange) - 10, Math.max(...simulatorSpeedRange) + 10] }, yaxis: { title: 'Dybde (m)', range: [100, 0] }, legend: { orientation: 'h', y: 1.15, font: { size: 9 } } }} /></div><div className="panel-foot"><span><i className="legend-dot red" /> {language === 'en' ? 'True SSP' : 'Sann SSP'} · g = {appliedGradient} m/s/m</span><span><i className="legend-dot blue dashed" /> {language === 'en' ? 'Measured SSP' : 'Målt SSP'} · g = {appliedMeasuredGradient} m/s/m</span></div></ModuleFrame>
              <ModuleFrame label="PANEL 03 · ±5 M" title="Rekonstruert havbunn" action={<button className="icon-button" title="Last ned CSV" aria-label="Last ned beregnede data som CSV" onClick={exportCsv}><Download size={16} /></button>}><div className="chart-area simulator-plot"><Chart id="bathymetry-plot" data={[
                { x: [-230, 230], y: [100, 100], mode: 'lines', name: 'Sann havbunn', line: { color: colors.red, width: 2.5 } },
                { x: seabedCurve.map((point) => point.x), y: seabedCurve.map((point) => point.z), mode: 'lines', name: 'Estimert · kvadratisk', line: { color: colors.blue, width: 2.5 } },
                { x: beams.map((beam) => beam.estimatedHit.x), y: beams.map((beam) => beam.estimatedHit.z), mode: 'markers', name: 'Strålepunkter', marker: { color: colors.ink, size: 5 }, hovertemplate: 'x %{x:.2f} m<br>z %{y:.3f} m<extra></extra>' },
              ]} layout={{ margin: { l: 48, r: 8, t: 24, b: 38 }, xaxis: { title: 'Avstand (m)' }, yaxis: { title: 'Dybde (m)', range: [105, 95] }, legend: { orientation: 'h', y: 1.15, font: { size: 9 } } }} /></div><div className="panel-foot"><span><i className="legend-dot red" /> {language === 'en' ? 'True seafloor' : 'Sann bunn'}</span><span><i className="legend-dot blue" /> {language === 'en' ? 'Interpolated estimate' : 'Interpolert estimat'}</span></div></ModuleFrame>
            </div><div className="simulator-footnote"><Info size={14} /><span>Sann SSP simulerer ekkoet. Tur-retur-tiden deles på to, og målt SSP-gradient brukes til å rekonstruere treffpunktet.</span><div className="export-actions"><button onClick={() => exportPlot('bathymetry-plot', 'png')}><Download size={14} /> PNG</button><button onClick={() => exportPlot('bathymetry-plot', 'svg')}><Download size={14} /> SVG</button><button onClick={exportCsv}><Download size={14} /> CSV</button></div></div>
          </div>
        </section>

        <ActiveSonar language={language} />

        <section id="quiz" className="lesson-section quiz-section">
          <SectionHeading number="09" eyebrow="HENT FRAM KUNNSKAPEN" title="Test den fysiske intuisjonen" description="Svar før du sjekker. Det finnes ikke poeng her – bare gode forbindelser mellom lydhastighet, strålegang og bunnkart." />
          <div className="quiz-grid">{quizItems.map((item, index) => <div className="quiz-card" key={item.question}><div className="quiz-card-head"><span>{language === 'en' ? `QUESTION 0${index + 1}` : `SPØRSMÅL 0${index + 1}`}</span><CircleHelp size={17} /></div><h3>{item.question}</h3><div className="quiz-options">{item.options.map((option, optionIndex) => { const answered = answers[index] !== undefined; const isSelected = answers[index] === optionIndex; return <button className={`quiz-option ${answered && isSelected ? (optionIndex === item.answer ? 'correct' : 'incorrect') : ''} ${answered && optionIndex === item.answer ? 'show-correct' : ''}`} key={option} onClick={() => setAnswers((current) => ({ ...current, [index]: optionIndex }))} disabled={answered}><span className="option-letter">{String.fromCharCode(65 + optionIndex)}</span>{option}{answered && optionIndex === item.answer && <Check size={15} />}</button> })}</div><AnimatePresence>{answers[index] !== undefined && <motion.p className={`quiz-feedback ${answers[index] === item.answer ? 'good' : 'try-again'}`} initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }}><strong>{answers[index] === item.answer ? (language === 'en' ? 'Correct.' : 'Riktig.') : (language === 'en' ? 'Not quite.' : 'Ikke helt.')}</strong> {item.explain}</motion.p>}</AnimatePresence></div>)}</div>
        </section>

      </main>
      <footer className="footer"><a className="brand footer-brand" href="#top"><span className="brand-mark"><AudioLines size={17} /></span><span>HAV<span className="brand-light"> / LAB</span></span></a><span>INTERAKTIVT LÆREVERK I HYDROAKUSTIKK</span><a href="#top">Til toppen <ArrowDown className="up-arrow" size={14} /></a></footer>
    </div>
  ), language)}</LanguageContext.Provider>
}

export default App