import { createRoot } from 'react-dom/client';
import '@photo-sphere-viewer/core/index.css';
import './styles/theme.css';
import App from './App';
import LoginGate from './components/LoginGate';

const root = createRoot(document.getElementById('root')!);
root.render(<LoginGate><App /></LoginGate>);
