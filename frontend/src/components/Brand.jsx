import { Sprout } from 'lucide-react';
export default function Brand({ compact = false }) {
  return <div className="brand"><span className="brand-mark"><Sprout size={24} strokeWidth={1.8}/></span><div><strong>青禾 <span>QINGHE</span></strong>{!compact && <small>智能灌溉实验室</small>}</div></div>;
}
