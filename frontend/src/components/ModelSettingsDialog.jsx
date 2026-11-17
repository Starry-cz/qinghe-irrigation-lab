import {useEffect,useRef} from 'react';
import {X} from 'lucide-react';
import ModelSettingsPanel from './ModelSettingsPanel.jsx';

// 原生对话框管理焦点和Esc关闭，设置模型时保留学生正在填写的实验草稿。
export default function ModelSettingsDialog({open,onClose,onChanged}) {
  const dialog=useRef(null);
  useEffect(()=>{
    if(open)dialog.current.showModal();
    else if(dialog.current.open)dialog.current.close();
  },[open]);
  return <dialog ref={dialog} className="model-settings-dialog" aria-labelledby="student-model-title" onCancel={onClose} onClick={event=>{if(event.target===dialog.current)onClose();}}>
    <div className="model-dialog-heading"><div><h2 id="student-model-title">模型设置</h2><p>选择实验默认模型，或连接自己的模型。</p></div><button type="button" className="icon-button" aria-label="关闭模型设置" onClick={onClose}><X size={21}/></button></div>
    {open&&<ModelSettingsPanel onChanged={onChanged}/>}
  </dialog>;
}
