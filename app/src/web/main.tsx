// Web app entry, served by the Sigil server at /app.
import { createRoot } from 'react-dom/client';
import { SigilCore } from '../core/client';
import { installBridge, IndexedDbVault, MemoryVault, deviceId, deviceLabel } from './bridge';
import { App } from '../renderer/App';
import '../../../shared/profileCard.css';
import '../renderer/styles.css';

const serverUrl = new URLSearchParams(location.search).get('server') ?? location.origin;
const vault = typeof indexedDB !== 'undefined' ? new IndexedDbVault() : new MemoryVault();
const core = new SigilCore({ serverUrl, vault, deviceId: deviceId(), deviceLabel: deviceLabel() });
installBridge(core);
createRoot(document.getElementById('root')!).render(<App />);
core.init();
