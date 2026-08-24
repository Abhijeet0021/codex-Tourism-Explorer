import { withHD } from '@hyperdart/frontend'
import hDConfig from '../../hyperdart.config'
import TourismExplorer from './TourismExplorer'

const HDTourismExplorer = withHD(TourismExplorer)

HDTourismExplorer.initHD(
	TourismExplorer,
	hDConfig.client.baseURL,
	hDConfig.deployedBackendURL
)

export default HDTourismExplorer
