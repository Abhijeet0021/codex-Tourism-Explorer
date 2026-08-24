import { useEffect, useMemo, useState } from 'react'
import {
	Alert,
	Box,
	Card,
	CardContent,
	Chip,
	Divider,
	Link,
	Skeleton,
	Stack,
	Typography
} from '@mui/material'
import PlaceOutlinedIcon from '@mui/icons-material/PlaceOutlined'

/* ------------------------------------------------------------------ */
/* Config                                                              */
/* ------------------------------------------------------------------ */

const API_KEY = import.meta.env.VITE_GEOAPIFY_KEY
const PLACES_URL = 'https://api.geoapify.com/v2/places'
const RADIUS_METRES = 5000
const LIMIT = 20

// Categories that must never be surfaced as primary tourism results.
const EXCLUDED_PREFIXES = [
	'catering',
	'accommodation',
	'commercial',
	'service',
	'rental',
	'office'
]

// Query wording -> Geoapify category string. First match wins.
// Verify subcategory spellings against the Geoapify category reference
// if you extend this list.
const CATEGORY_RULES = [
	{ test: /\bmuseums?\b/, categories: 'entertainment.museum' },
	{ test: /\bart\s+galler(y|ies)\b/, categories: 'entertainment.culture.gallery' },
	{ test: /\bviewpoints?\b/, categories: 'tourism.attraction.viewpoint' },
	{ test: /\b(monuments?|memorials?)\b/, categories: 'tourism.sights.memorial' },
	{ test: /\b(castles?|forts?|palaces?)\b/, categories: 'tourism.sights.castle' },
	{
		test: /\b(temples?|churches?|mosques?|shrines?|cathedrals?)\b/,
		categories: 'tourism.sights.place_of_worship'
	},
	{ test: /\b(ruins?|archaeolog\w*)\b/, categories: 'tourism.sights.archaeological_site' },
	{
		test: /\b(landmarks?|historical?|heritage|monuments?)\b/,
		categories: 'tourism.sights,tourism.attraction'
	}
]

const DEFAULT_CATEGORIES = 'tourism.sights,tourism.attraction'

/* ------------------------------------------------------------------ */
/* Pure helpers                                                        */
/* ------------------------------------------------------------------ */

/** Pull the resolved city entity out of the searchData payload. */
function resolveCity(searchData) {
	const entities = searchData?.entities ?? []

	const cityEntity =
		entities.find(
			(e) => e?.collectionType === 'HD_LOCATION' && e?.entityInfo?.geo
		) ?? entities.find((e) => e?.entityInfo?.geo)

	const geo = cityEntity?.entityInfo?.geo
	if (!geo || typeof geo.lat !== 'number' || typeof geo.long !== 'number') {
		return null
	}

	return {
		name: geo.city || cityEntity?.word || 'this area',
		country: geo.country || '',
		lat: geo.lat,
		lon: geo.long // note: the payload uses `long`, not `lng`
	}
}

/** Map the natural-language query to a Geoapify categories value. */
function resolveCategories(query = '') {
	const q = (query || '').toLowerCase()
	const match = CATEGORY_RULES.find((rule) => rule.test.test(q))
	return match ? match.categories : DEFAULT_CATEGORIES
}

/** Turn a Geoapify categories array into one readable label. */
function labelFor(categories = []) {
	const preferred =
		categories.find((c) => c.startsWith('tourism.sights.')) ??
		categories.find((c) => c.startsWith('tourism.attraction.')) ??
		categories.find((c) => c.startsWith('entertainment.')) ??
		categories.find((c) => c.startsWith('tourism.')) ??
		categories[0]

	if (!preferred) return 'Attraction'

	return preferred
		.split('.')
		.pop()
		.replace(/_/g, ' ')
		.replace(/\b\w/g, (ch) => ch.toUpperCase())
}

/** Drop out-of-scope results, blank names, and duplicates. */
function normalise(features = []) {
	const seen = new Set()
	const out = []

	for (const feature of features) {
		const p = feature?.properties
		if (!p?.name) continue

		const cats = p.categories ?? []
		if (cats.some((c) => EXCLUDED_PREFIXES.some((bad) => c.startsWith(bad)))) {
			continue
		}

		const key = p.name.toLowerCase()
		if (seen.has(key)) continue
		seen.add(key)

		const lat = p.lat ?? feature?.geometry?.coordinates?.[1]
		const lon = p.lon ?? feature?.geometry?.coordinates?.[0]

		out.push({
			id: p.place_id ?? key,
			name: p.name,
			category: labelFor(cats),
			lat,
			lon,
			description: p.description?.trim() || '',
			address: p.formatted?.trim() || ''
		})
	}

	return out
}

function buildUrl({ lat, lon }, categories) {
	const params = new URLSearchParams({
		categories,
		filter: `circle:${lon},${lat},${RADIUS_METRES}`,
		limit: String(LIMIT),
		apiKey: API_KEY ?? ''
	})
	return `${PLACES_URL}?${params.toString()}`
}

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

export default function TourismExplorer({ searchData, messageHandlers }) {
	// Tell the platform we've mounted, so it doesn't time out at 3s.
	useEffect(() => {
		messageHandlers?.componentLoaded?.()
	}, [messageHandlers])

	// Case 1: no query performed yet — searchData absent or empty object.
	const hasSearchData =
		!!searchData && Object.keys(searchData).length > 0

	const city = useMemo(
		() => (hasSearchData ? resolveCity(searchData) : null),
		[searchData, hasSearchData]
	)

	const categories = useMemo(
		() => resolveCategories(searchData?.query ?? searchData?.queryTerm),
		[searchData]
	)

	const [places, setPlaces] = useState([])
	const [status, setStatus] = useState('idle') // idle | loading | ready | error
	const [error, setError] = useState('')

	useEffect(() => {
		// Nothing to do until a matching query arrives.
		if (!hasSearchData) {
			setStatus('idle')
			return
		}

		if (!city) {
			setStatus('error')
			setError('No city was resolved from this query. Try naming the city explicitly.')
			return
		}

		if (!API_KEY) {
			setStatus('error')
			setError('Geoapify API key is missing. Set VITE_GEOAPIFY_KEY in your .env file.')
			return
		}

		const controller = new AbortController()

		async function load() {
			setStatus('loading')
			setError('')
			try {
				const res = await fetch(buildUrl(city, categories), { signal: controller.signal })
				if (!res.ok) throw new Error(`Geoapify responded with ${res.status}`)
				const data = await res.json()
				setPlaces(normalise(data?.features))
				setStatus('ready')
			} catch (err) {
				if (err.name === 'AbortError') return
				setError(err.message || 'Something went wrong fetching attractions.')
				setStatus('error')
			}
		}

		load()
		return () => controller.abort()
	}, [hasSearchData, city, categories])

	/* ---------------- render ---------------- */

	// Case 1: empty query. Stay quiet — the Sandbox shows its own notice.
	if (!hasSearchData) {
		return (
			<Box sx={{ p: 2 }}>
				<Typography variant="body2" color="text.secondary">
					Search for something like “tourist attractions in NYC” to see places to visit.
				</Typography>
			</Box>
		)
	}

	if (status === 'error') {
		return (
			<Box sx={{ p: 2 }}>
				<Alert severity="warning">{error}</Alert>
			</Box>
		)
	}

	if (status === 'loading' || status === 'idle') {
		return (
			<Box sx={{ p: 2 }}>
				<Skeleton variant="text" width={220} height={32} />
				<Stack spacing={1.5} sx={{ mt: 2 }}>
					{[0, 1, 2, 3].map((i) => (
						<Skeleton key={i} variant="rounded" height={92} />
					))}
				</Stack>
			</Box>
		)
	}

	if (places.length === 0) {
		return (
			<Box sx={{ p: 2 }}>
				<Typography variant="h6" gutterBottom>
					Things to see in {city.name}
				</Typography>
				<Alert severity="info">
					No tourist attractions found within {RADIUS_METRES / 1000} km of{' '}
					{city.name}. Try a nearby larger city.
				</Alert>
			</Box>
		)
	}

	return (
		<Box sx={{ p: 2 }}>
			<Typography variant="h6">Things to see in {city.name}</Typography>
			<Typography variant="body2" color="text.secondary" gutterBottom>
				{places.length} {places.length === 1 ? 'place' : 'places'} within{' '}
				{RADIUS_METRES / 1000} km of the city centre
			</Typography>

			<Divider sx={{ my: 1.5 }} />

			<Stack spacing={1.5}>
				{places.map((place) => (
					<Card key={place.id} variant="outlined">
						<CardContent sx={{ '&:last-child': { pb: 2 } }}>
							<Stack
								direction="row"
								justifyContent="space-between"
								alignItems="flex-start"
								spacing={1}
							>
								<Typography variant="subtitle1" fontWeight={600}>
									{place.name}
								</Typography>
								<Chip label={place.category} size="small" />
							</Stack>

							{place.description && (
								<Typography variant="body2" color="text.secondary" sx={{ mt: 0.75 }}>
									{place.description}
								</Typography>
							)}

							{place.address && (
								<Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.75 }}>
									{place.address}
								</Typography>
							)}

							{Number.isFinite(place.lat) && Number.isFinite(place.lon) && (
								<Stack direction="row" spacing={0.5} alignItems="center" sx={{ mt: 0.75 }}>
									<PlaceOutlinedIcon sx={{ fontSize: 15, color: 'text.disabled' }} />
									<Link
										href={`https://www.openstreetmap.org/?mlat=${place.lat}&mlon=${place.lon}#map=17/${place.lat}/${place.lon}`}
										target="_blank"
										rel="noopener noreferrer"
										variant="caption"
										underline="hover"
									>
										{place.lat.toFixed(5)}, {place.lon.toFixed(5)}
									</Link>
								</Stack>
							)}
						</CardContent>
					</Card>
				))}
			</Stack>
		</Box>
	)
}
