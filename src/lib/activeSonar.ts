export type SoundSpeedPoint = { depth: number; speed: number }
export type Interpolation = 'linear' | 'cubic'

export const MAX_RANGE = 15000
export const WATER_DEPTH = 500
export const RANGE_CELLS = 60
export const DEPTH_CELLS = 25
export const RAY_CALCULATION_COUNT = 605
export const RAY_DISPLAY_COUNT = 61
export const SEABED_REFLECTION_LOSS_DB = 8
const GAUSSIAN_WINDOW_DEPTH_CELLS = 5
const GAUSSIAN_WINDOW_RANGE_CELLS = 10
const DISPLAY_RAY_INDICES = new Set(Array.from(
  { length: RAY_DISPLAY_COUNT },
  (_, index) => Math.round(index * (RAY_CALCULATION_COUNT - 1) / (RAY_DISPLAY_COUNT - 1)),
))

export const EDUCATIONAL_PROFILE: SoundSpeedPoint[] = [
  { depth: 0, speed: 1522 },
  { depth: 20, speed: 1524 },
  { depth: 45, speed: 1512 },
  { depth: 80, speed: 1495 },
  { depth: 120, speed: 1484 },
  { depth: 165, speed: 1477 },
  { depth: 200, speed: 1474 },
  { depth: 260, speed: 1477 },
  { depth: 340, speed: 1484 },
  { depth: 420, speed: 1492 },
  { depth: 500, speed: 1500 },
]

export function sortProfile(profile: SoundSpeedPoint[]) {
  return [...profile].sort((first, second) => first.depth - second.depth)
}

function cubicSecondDerivatives(points: SoundSpeedPoint[]) {
  const second = Array(points.length).fill(0) as number[]
  if (points.length < 3) return second
  const diagonal = Array(points.length - 2).fill(0) as number[]
  const upper = Array(points.length - 2).fill(0) as number[]
  const rhs = Array(points.length - 2).fill(0) as number[]
  for (let index = 1; index < points.length - 1; index += 1) {
    const leftWidth = points[index].depth - points[index - 1].depth
    const rightWidth = points[index + 1].depth - points[index].depth
    const row = index - 1
    diagonal[row] = 2 * (leftWidth + rightWidth)
    upper[row] = rightWidth
    rhs[row] = 6 * ((points[index + 1].speed - points[index].speed) / rightWidth - (points[index].speed - points[index - 1].speed) / leftWidth)
    if (row > 0) diagonal[row] -= leftWidth * upper[row - 1] / diagonal[row - 1]
    if (row > 0) rhs[row] -= leftWidth * rhs[row - 1] / diagonal[row - 1]
  }
  second[points.length - 2] = rhs[rhs.length - 1] / diagonal[diagonal.length - 1]
  for (let index = points.length - 3; index > 0; index -= 1) {
    const row = index - 1
    second[index] = (rhs[row] - upper[row] * second[index + 1]) / diagonal[row]
  }
  return second
}

export function soundSpeedAt(profile: SoundSpeedPoint[], depth: number, interpolation: Interpolation): number {
  const points = sortProfile(profile)
  return interpolateSpeed(points, depth, interpolation, interpolation === 'cubic' ? cubicSecondDerivatives(points) : [])
}

function interpolateSpeed(points: SoundSpeedPoint[], depth: number, interpolation: Interpolation, second: number[]): number {
  if (points.length === 0) return 1500
  if (depth <= points[0].depth) return points[0].speed
  if (depth >= points[points.length - 1].depth) return points[points.length - 1].speed
  let upperIndex = points.findIndex((point) => point.depth >= depth)
  if (upperIndex < 1) upperIndex = 1
  const lower = points[upperIndex - 1]
  const upper = points[upperIndex]
  const width = upper.depth - lower.depth
  const fraction = (depth - lower.depth) / width
  if (interpolation === 'linear' || points.length < 3) return lower.speed + fraction * (upper.speed - lower.speed)
  const a = 1 - fraction
  const b = fraction
  return a * lower.speed + b * upper.speed + ((a ** 3 - a) * second[upperIndex - 1] + (b ** 3 - b) * second[upperIndex]) * width ** 2 / 6
}

export function detectProfileFeatures(profile: SoundSpeedPoint[]) {
  const points = sortProfile(profile)
  if (points.length < 3) return []
  const minimumIndex = points.reduce((best, point, index) => point.speed < points[best].speed ? index : best, 0)
  const labels: Array<{ depth: number; label: string }> = []
  if (minimumIndex > 0 && minimumIndex < points.length - 1) labels.push({ depth: points[minimumIndex].depth, label: 'LYDKANAL' })
  const strongestGradient = points.slice(1).map((point, index) => ({
    depth: (point.depth + points[index].depth) / 2,
    gradient: (point.speed - points[index].speed) / (point.depth - points[index].depth),
  })).filter((item) => item.depth < 180).sort((a, b) => Math.abs(b.gradient) - Math.abs(a.gradient))[0]
  if (strongestGradient && Math.abs(strongestGradient.gradient) >= 0.025) labels.push({ depth: strongestGradient.depth, label: 'TERMOklin'.toUpperCase() })
  if (points[0].speed > points[Math.min(2, minimumIndex)].speed && points[0].depth < 40) labels.push({ depth: Math.min(35, points[1].depth), label: 'OVERFLATEKANAL' })
  return labels
}

export type RayField = {
  rangeCenters: number[]
  depthCenters: number[]
  energy: number[][]
  relativeEnergy: number[][]
  transmissionLoss: number[][]
  maximumEnergy: number
  rays: Array<{ x: number[]; z: number[] }>
}

function depositSegment(energy: number[][], x0: number, z0: number, x1: number, z1: number, weight: number) {
  const dx = x1 - x0
  const dz = z1 - z0
  const distance = Math.hypot(dx, dz)
  if (distance === 0) return
  const cuts = [0, 1]
  if (dx !== 0) {
    const minX = Math.min(x0, x1)
    const maxX = Math.max(x0, x1)
    for (let boundary = Math.ceil(minX / 250) * 250; boundary < maxX; boundary += 250) cuts.push((boundary - x0) / dx)
  }
  if (dz !== 0) {
    const minZ = Math.min(z0, z1)
    const maxZ = Math.max(z0, z1)
    for (let boundary = Math.ceil(minZ / 20) * 20; boundary < maxZ; boundary += 20) cuts.push((boundary - z0) / dz)
  }
  cuts.sort((first, second) => first - second)
  for (let index = 1; index < cuts.length; index += 1) {
    const start = cuts[index - 1]
    const end = cuts[index]
    if (end - start < 1e-10) continue
    const midpoint = (start + end) / 2
    const x = x0 + dx * midpoint
    const z = z0 + dz * midpoint
    const column = Math.max(0, Math.min(RANGE_CELLS - 1, Math.floor(x / 250)))
    const row = Math.max(0, Math.min(DEPTH_CELLS - 1, Math.floor(z / 20)))
    energy[row][column] += distance * (end - start) * weight
  }
}

function traceRayEnergy(profile: SoundSpeedPoint[], interpolation: Interpolation, sonarDepth: number, seabedReflectionLossDb = SEABED_REFLECTION_LOSS_DB, recordRays = true) {
  const energy = Array.from({ length: DEPTH_CELLS }, () => Array(RANGE_CELLS).fill(0) as number[])
  const rays: RayField['rays'] = []
  const sortedProfile = sortProfile(profile)
  const secondDerivatives = interpolation === 'cubic' ? cubicSecondDerivatives(sortedProfile) : []
  const speedAt = (depth: number) => interpolateSpeed(sortedProfile, depth, interpolation, secondDerivatives)
  const step = 10
  const reflectionRetention = 10 ** (-seabedReflectionLossDb / 10)
  for (let rayIndex = 0; rayIndex < RAY_CALCULATION_COUNT; rayIndex += 1) {
    const recordRay = recordRays && DISPLAY_RAY_INDICES.has(rayIndex)
    let rayWeight = 1 / RAY_CALCULATION_COUNT
    let angle = (-30 + 60 * rayIndex / (RAY_CALCULATION_COUNT - 1)) * Math.PI / 180
    let x = 0
    let z = sonarDepth
    const rayX = recordRay ? [0] : []
    const rayZ = recordRay ? [z] : []
    for (let iteration = 0; iteration < MAX_RANGE / step; iteration += 1) {
      const speed = speedAt(z)
      const gradient = (speedAt(Math.min(WATER_DEPTH, z + 1)) - speedAt(Math.max(0, z - 1))) / (Math.min(WATER_DEPTH, z + 1) - Math.max(0, z - 1) || 1)
      const nextAngle = angle - (gradient / speed) * step
      const midpointAngle = (angle + nextAngle) / 2
      const nextX = x + step
      let nextZ = z + Math.tan(midpointAngle) * step
      const hitSeabed = nextZ > WATER_DEPTH
      if (nextZ < 0) {
        nextZ = -nextZ
        angle = -nextAngle
      } else if (nextZ > WATER_DEPTH) {
        nextZ = 2 * WATER_DEPTH - nextZ
        angle = -nextAngle
      } else angle = nextAngle
      nextZ = Math.max(0, Math.min(WATER_DEPTH, nextZ))
      depositSegment(energy, x, z, nextX, nextZ, rayWeight)
      if (hitSeabed) rayWeight *= reflectionRetention
      x = nextX
      z = nextZ
      if (recordRay && (iteration % 5 === 4 || iteration === MAX_RANGE / step - 1)) {
        rayX.push(x)
        rayZ.push(z)
      }
    }
    if (recordRay) rays.push({ x: rayX, z: rayZ })
  }
  return { energy, rays }
}

function gaussianSmoothEnergy(energy: number[][]) {
  const depthRadius = Math.floor((GAUSSIAN_WINDOW_DEPTH_CELLS - 1) / 2)
  const rangeStart = -Math.floor((GAUSSIAN_WINDOW_RANGE_CELLS - 1) / 2)
  const depthSigma = GAUSSIAN_WINDOW_DEPTH_CELLS / 6
  const rangeSigma = GAUSSIAN_WINDOW_RANGE_CELLS / 6

  return energy.map((row, depthIndex) => row.map((_, rangeIndex) => {
    let weightedEnergy = 0
    let totalWeight = 0
    for (let depthOffset = -depthRadius; depthOffset <= depthRadius; depthOffset += 1) {
      for (let rangeStep = 0; rangeStep < GAUSSIAN_WINDOW_RANGE_CELLS; rangeStep += 1) {
        const rangeOffset = rangeStart + rangeStep
        const neighborDepth = depthIndex + depthOffset
        const neighborRange = rangeIndex + rangeOffset
        if (neighborDepth < 0 || neighborDepth >= energy.length || neighborRange < 0 || neighborRange >= row.length) continue
        const weight = Math.exp(-0.5 * ((depthOffset / depthSigma) ** 2 + (rangeOffset / rangeSigma) ** 2))
        weightedEnergy += energy[neighborDepth][neighborRange] * weight
        totalWeight += weight
      }
    }
    return totalWeight > 0 ? weightedEnergy / totalWeight : 0
  }))
}

export function traceRayField(profile: SoundSpeedPoint[], interpolation: Interpolation, sonarDepth: number, seabedReflectionLossDb = SEABED_REFLECTION_LOSS_DB): RayField {
  const { energy: rawEnergy, rays } = traceRayEnergy(profile, interpolation, sonarDepth, seabedReflectionLossDb)
  const energy = gaussianSmoothEnergy(rawEnergy)
  const referenceProfile = [{ depth: 0, speed: 1500 }, { depth: WATER_DEPTH, speed: 1500 }]
  const referenceEnergy = gaussianSmoothEnergy(traceRayEnergy(referenceProfile, 'linear', sonarDepth, seabedReflectionLossDb, false).energy)
  const maximumEnergy = Math.max(0, ...energy.flat())
  const relativeEnergy = energy.map((row) => row.map((value) => maximumEnergy > 0 ? value / maximumEnergy : 0))
  const transmissionLoss = energy.map((row, depthIndex) => row.map((value, rangeIndex) => {
    const range = rangeIndex * 250 + 125
    const reference = referenceEnergy[depthIndex][rangeIndex]
    const densityCorrection = value > 0 && reference > 0 ? -10 * Math.log10(value / reference) : 80
    return 20 * Math.log10(range) + densityCorrection
  }))
  return {
    rangeCenters: Array.from({ length: RANGE_CELLS }, (_, index) => index * 250 + 125),
    depthCenters: Array.from({ length: DEPTH_CELLS }, (_, index) => index * 20 + 10),
    energy,
    relativeEnergy,
    transmissionLoss,
    maximumEnergy,
    rays,
  }
}

export function targetStrength(aspectDegrees: number, minimum = -5, maximum = 10) {
  const radians = aspectDegrees * Math.PI / 180
  return minimum + (maximum - minimum) * Math.sin(radians) ** 2
}

export function signalExcess(tl: number, bandwidth: number, pulseLength: number, targetStrengthDb: number, sourceLevel: number, noiseLevel: number, threshold: number, range: number, absorption: boolean) {
  const totalOneWayLoss = tl + (absorption ? 0.005 * range : 0)
  return sourceLevel - 2 * totalOneWayLoss + 10 * Math.log10(bandwidth * pulseLength) + targetStrengthDb - noiseLevel - threshold
}