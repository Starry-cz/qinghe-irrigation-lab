import { useId, useRef, useState } from 'react';
import { Expand, X, MoveHorizontal, Droplets, Activity } from 'lucide-react';
import { WEATHER } from '../../../shared/definitions.js';
import './LabScene.css';

const DEVICES = [
  { id:'tank', number:'01', name:'储水箱', description:'为水泵提供水源。本实验默认水源充足，水箱液位不代表实际剩余容量。' },
  { id:'pump', number:'02', name:'微型水泵', description:'接收驱动模块的输出，把水从储水箱送到花盆上方的出水口。' },
  { id:'controller', number:'03', name:'控制器', description:'读取土壤传感器与天气预报，按当前实验规则决定是否启动水泵。' },
  { id:'driver', number:'04', name:'水泵驱动', description:'把控制器的控制信号转换为水泵的通断动作。电机由驱动模块供电。' },
  { id:'sensor', number:'05', name:'土壤湿度探头', description:'探测端插入土壤，将土壤水分变化传给控制器。读数含义由本轮实验的标定决定。' },
  { id:'pot', number:'06', name:'实验花盆', description:'剖面显示探头与根系在土壤中的位置。土壤颜色随模拟水分变化，底部保留排水通道。' },
];

function Device({ id, selected, onSelect, bounds, children }) {
  const device=DEVICES.find(d=>d.id===id);
  return <g className={`equipment-device ${selected===id?'is-selected':''}`} role="button" tabIndex={0}
    aria-label={`识别${device.name}`} aria-pressed={selected===id} onClick={()=>onSelect(id)}
    onKeyDown={event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();onSelect(id);}}}>
    <title>{device.name} · 点击查看作用</title>
    <rect className="device-selection" {...bounds} rx="14"/>
    {children}
  </g>;
}

function DeviceLabel({ id, x, y, sub }) {
  const device=DEVICES.find(d=>d.id===id);
  return <g className="device-label">
    <text x={x} y={y} className="device-number">{device.number}</text>
    <text x={x+30} y={y} className="device-name">{device.name}</text>
    {sub&&<text x={x+30} y={y+22} className="device-subtitle">{sub}</text>}
  </g>;
}

// 水路在下方、驱动线居中、探头信号沿上方和右边缘走线，互不交叉。
function EquipmentDrawing({ state, selected, onSelect }) {
  const uid=useId().replaceAll(':','');
  const paint=name=>`url(#${uid}-${name})`;
  const {reading,weather,fraction,sensorConnected,pumpConnected,watering,animated,showRain,pumpStatus}=state;
  const soilColor=fraction>.65?'#68503a':fraction>.35?'#8c6c49':'#b09268';
  const inlet='M258 450 H414';
  const outlet='M540 450 H646 Q664 450 664 432 V352 Q664 334 682 334 H775 V350';
  const sensorPath=sensorConnected?'M912 310 H957 Q976 310 976 291 V167 Q976 148 957 148 H605':'M938 310 H957 Q976 310 976 291 V167 Q976 148 957 148 H605';
  return <svg viewBox="0 0 1020 590" className="equipment-svg" role="group" aria-labelledby={`${uid}-title ${uid}-desc`}>
    <title id={`${uid}-title`}>自动灌溉设备识别与功能连接图</title>
    <desc id={`${uid}-desc`}>储水箱经水泵向花盆供水；控制器通过驱动模块控制水泵；土壤探头向控制器返回读数。水管、驱动线和信号线分开布置。可点选六种设备查看说明。</desc>
    <defs>
      <linearGradient id={`${uid}-glass`} x1="0" x2="1"><stop stopColor="#e3efec"/><stop offset=".55" stopColor="#f8fcfa"/><stop offset="1" stopColor="#d8e9e6"/></linearGradient>
      <linearGradient id={`${uid}-water`} x1="0" x2="0" y1="0" y2="1"><stop stopColor="#97ccd2"/><stop offset="1" stopColor="#5b9eaa"/></linearGradient>
      <linearGradient id={`${uid}-pot`}><stop stopColor="#c7ac84"/><stop offset=".5" stopColor="#e4d1b4"/><stop offset="1" stopColor="#b79970"/></linearGradient>
      <linearGradient id={`${uid}-metal`} x1="0" x2="0" y1="0" y2="1"><stop stopColor="#f8fbf8"/><stop offset="1" stopColor="#dce6df"/></linearGradient>
      <pattern id={`${uid}-grid`} width="32" height="32" patternUnits="userSpaceOnUse"><path d="M32 0H0V32" fill="none" stroke="#cfdbcf" strokeWidth=".7" opacity=".5"/></pattern>
      <pattern id={`${uid}-soil`} width="22" height="18" patternUnits="userSpaceOnUse"><circle cx="5" cy="5" r="1.4" fill="#efdcba" opacity=".35"/><circle cx="16" cy="13" r="1" fill="#4a3c2d" opacity=".3"/></pattern>
      <marker id={`${uid}-signal-arrow`} markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto"><path d="M1 1L6 4L1 7" fill="none" stroke="#527d69" strokeWidth="1.5"/></marker>
      <clipPath id={`${uid}-soil-clip`}><path d="M751 365H929L910 488Q838 509 768 488Z"/></clipPath>
    </defs>
    <rect width="1020" height="590" rx="16" fill="var(--scene-bg)"/>
    <rect width="1020" height="590" rx="16" fill={paint('grid')}/>
    <text x="36" y="38" className="drawing-kicker">QINGHE / IRRIGATION LAB</text>
    <g transform="translate(806 26)">
      <g fill="none" stroke={weather==='sunny'?'#a77b2c':'#637f89'} strokeWidth="2">
        {weather==='sunny'?<><circle cx="14" cy="14" r="8"/><path d="M14 1V-3M14 27V31M1 14H-3M27 14H31M5 5L2 2M23 23L26 26M5 23L2 26M23 5L26 2"/></>:<path d="M0 22H28A8 8 0 0 0 29 6A12 12 0 0 0 7 8A7 7 0 0 0 0 22Z"/>}
        {weather==='rainy'&&<path d="M6 27L3 32M17 27L14 32M28 27L25 32" strokeDasharray="2 3"/>}
      </g>
      <text x="42" y="19" className="device-subtitle">预报：{weather==='rainy'?'有雨':WEATHER[weather]}</text>
    </g>
    <ellipse cx="171" cy="507" rx="112" ry="14" fill="#dce5d8" opacity=".6"/>
    <ellipse cx="477" cy="502" rx="88" ry="11" fill="#dce5d8" opacity=".6"/>
    <ellipse cx="838" cy="513" rx="116" ry="15" fill="#dce5d8" opacity=".6"/>

    {/* 功能线先于设备绘制，端点落到接头，避免穿过面板和文字。 */}
    <g fill="none" strokeLinecap="round" strokeLinejoin="round" className={selected==='tank'||selected==='pump'||selected==='pot'?'route-highlight':''}>
      {[inlet,outlet].map((d,i)=><g key={i}><path d={d} stroke="#a5bfc3" strokeWidth="13"/><path d={d} stroke={watering?'#438fa1':'#d9e8e9'} strokeWidth="7"/>{animated&&<path d={d} stroke="#e9ffff" strokeWidth="3" strokeDasharray="5 14" className="flow-line"/>}</g>)}
      <path d="M308 444L316 450L308 456M584 444L592 450L584 456M769 340L775 348L781 340" stroke="#397b8b" strokeWidth="2"/>
    </g>
    <text x="598" y="483" className="route-label water-label" textAnchor="middle">供水管 · → 花盆</text>
    <g fill="none" stroke="#ad8137" strokeWidth="3" strokeLinecap="round">
      <path d="M480 231V270"/>
      <path d={pumpConnected?'M480 337V425':'M480 337V385 M480 404V425'} strokeDasharray={pumpConnected?undefined:'6 5'}/>
    </g>
    <text x="497" y="379" className="route-label drive-label">{pumpConnected?'驱动输出':'输出断开'}</text>
    {!pumpConnected&&<g stroke="#a15740" strokeWidth="2"><path d="M474 390L486 400M486 390L474 400"/></g>}
    <path d={sensorPath} fill="none" stroke={sensorConnected?'#527d69':'#9b8a65'} strokeWidth="3" strokeDasharray={sensorConnected?undefined:'7 5'} strokeLinejoin="round"/>
    <path d="M711 148H684" stroke="#527d69" strokeWidth="2" markerEnd={paint('signal-arrow')}/>
    <text x="703" y="130" className="route-label signal-label">土壤读数 → 控制器</text>
    {!sensorConnected&&<path d="M920 304L931 316M931 304L920 316" stroke="#a15740" strokeWidth="2"/>}

    <Device id="tank" selected={selected} onSelect={onSelect} bounds={{x:54,y:317,width:229,height:252}}>
      <path d="M82 351H258V482Q170 519 82 482Z" fill={paint('glass')} stroke="#9fbfba" strokeWidth="1.5"/>
      <path d="M84 404Q170 424 256 404V481Q170 516 84 481Z" fill={paint('water')}/>
      <ellipse cx="170" cy="404" rx="86" ry="16" fill="#b7dce0"/>
      <ellipse cx="170" cy="351" rx="88" ry="19" fill="#eef7f2" stroke="#9fbfba" strokeWidth="1.5"/>
      <ellipse cx="170" cy="351" rx="71" ry="12" fill="#cddfd8"/>
      <path d="M103 380H120M103 413H115M103 446H120M103 479H115" stroke="#447c84" strokeWidth="2"/>
      <rect x="249" y="441" width="15" height="18" rx="4" fill="#e6efea" stroke="#88a9a6"/>
      <text x="177" y="459" textAnchor="middle" fontSize="25" fill="#2d626c">H₂O</text>
      <DeviceLabel id="tank" x={74} y={539} sub="水源充足 · 默认补给"/>
    </Device>

    <Device id="controller" selected={selected} onSelect={onSelect} bounds={{x:337,y:42,width:287,height:200}}>
      <DeviceLabel id="controller" x={355} y={65}/>
      <rect x="355" y="81" width="250" height="150" rx="13" fill={paint('metal')} stroke="#a8bbae" strokeWidth="1.5"/>
      {[367,593].map(x=><g key={x}><circle cx={x} cy="94" r="3" fill="#b5c3b8"/><circle cx={x} cy="218" r="3" fill="#b5c3b8"/></g>)}
      <rect x="374" y="100" width="212" height="90" rx="7" fill="#244e42"/>
      <text x="389" y="121" fontSize="13" fill="#bddbcb">土壤传感器读数</text>
      <text x="389" y="161" fontSize="36" fill="#ecf5e5" fontFamily="var(--font-mono)">{sensorConnected?reading:'— — — —'}</text>
      <text x="389" y="181" fontSize="12" fill="#bddbcb">{sensorConnected?'A0 · 已接入':'A0 · 未连接探头'}</text>
      <circle cx="569" cy="116" r="4" fill={sensorConnected?'#b5d79b':'#e0b57a'}/>
      <text x="374" y="214" className="device-subtitle">天气输入：{WEATHER[weather]}</text>
      <rect x="597" y="141" width="12" height="14" rx="3" fill="#eaf2e9" stroke="#527d69"/>
      <rect x="470" y="226" width="20" height="10" rx="2" fill="#eddcba" stroke="#ad8137"/>
    </Device>

    <Device id="driver" selected={selected} onSelect={onSelect} bounds={{x:383,y:245,width:193,height:104}}>
      <rect x="400" y="270" width="160" height="67" rx="9" fill="#f1ebdd" stroke="#b5a17c" strokeWidth="1.5"/>
      <rect x="416" y="283" width="51" height="40" rx="5" fill="#748474"/>
      <path d="M425 300H435M435 292V308M435 300L454 290M453 306H458" fill="none" stroke="#edf1e5" strokeWidth="2"/>
      <text x="482" y="296" className="device-subtitle">驱动模块</text>
      <text x="482" y="319" className="driver-state">{watering?'输出开启':'输出关闭'}</text>
      <DeviceLabel id="driver" x={584} y={300}/>
      <rect x="471" y="333" width="18" height="9" rx="2" fill="#eddcba" stroke="#ad8137"/>
    </Device>

    <Device id="pump" selected={selected} onSelect={onSelect} bounds={{x:389,y:405,width:178,height:164}}>
      <path d="M421 490H534L542 501H413Z" fill="#a9bab0"/>
      <rect x="414" y="425" width="126" height="67" rx="15" fill={paint('metal')} stroke="#91aaa0" strokeWidth="1.5"/>
      <rect x="407" y="441" width="14" height="18" rx="3" fill="#d4e1df" stroke="#91aaa0"/>
      <rect x="533" y="441" width="14" height="18" rx="3" fill="#d4e1df" stroke="#91aaa0"/>
      <circle cx="473" cy="458" r="25" fill="#f6faf5" stroke="#b2c6ba"/>
      <g className={animated?'pump-spinning':''} style={{transformOrigin:'473px 458px'}} fill={watering?'#428c85':'#9fb8aa'}>
        <path d="M473 438Q491 442 473 458Q455 454 473 438M493 458Q489 476 473 458Q477 440 493 458M473 478Q455 474 473 458Q491 462 473 478M453 458Q457 440 473 458Q469 476 453 458"/>
      </g>
      <circle cx="473" cy="458" r="5" fill="#e8f1e6"/>
      <circle cx="520" cy="438" r="4" fill={!pumpConnected?'#ba8056':watering?'#478f65':'#86a281'}/>
      <DeviceLabel id="pump" x={399} y={539} sub={pumpStatus}/>
    </Device>

    <Device id="pot" selected={selected} onSelect={onSelect} bounds={{x:712,y:174,width:248,height:395}}>
      <path d="M735 365H941L918 496Q837 529 758 496Z" fill={paint('pot')} stroke="#b09675" strokeWidth="1.5"/>
      <ellipse cx="838" cy="365" rx="103" ry="27" fill="#ead9ba" stroke="#b09675" strokeWidth="1.5"/>
      <ellipse cx="838" cy="365" rx="90" ry="20" fill={soilColor}/>
      {/* 土壤剖面而非外露探针：根系、探测段均画在花盆内部。 */}
      <g clipPath={paint('soil-clip')}>
        <path d="M751 378Q838 400 929 378V510H751Z" fill={soilColor}/>
        <rect x="751" y="378" width="180" height="132" fill={paint('soil')}/>
        <g fill="none" stroke="#d5bb8e" strokeWidth="2" strokeLinecap="round">
          <path d="M836 369Q834 411 824 443L810 474M834 405L861 427L872 460M827 432L800 450L793 470M859 425L879 433M825 442L842 470L836 488M810 473L821 484"/>
        </g>
      </g>
      <path d="M837 364Q817 298 841 210M833 307L798 274M832 277L870 246" fill="none" stroke="#486e45" strokeWidth="5" strokeLinecap="round"/>
      <path d="M832 310Q778 297 764 258Q812 253 832 310" fill="#698f55"/>
      <path d="M835 277Q811 229 835 196Q867 226 835 277" fill="#4f7b46"/>
      <path d="M839 290Q867 239 915 245Q908 287 839 290" fill="#36714e"/>
      <path d="M836 325Q882 290 920 312Q899 348 836 325" fill="#83a065"/>
      <path d="M834 251Q787 235 793 201Q823 203 834 251" fill="#98ad77"/>
      <path d="M791 473L804 481M875 478L888 473" stroke="#e2ca9e" strokeWidth="1.5"/>
      <path d="M823 510H852" stroke="#7c6c53" strokeWidth="4" strokeLinecap="round"/>
      <DeviceLabel id="pot" x={747} y={539} sub="土壤剖面 · 底部排水"/>
    </Device>

    <Device id="sensor" selected={selected} onSelect={onSelect} bounds={{x:884,y:298,width:50,height:148}}>
      <rect x="899" y="308" width="25" height="48" rx="5" fill="#396655" stroke="#2d5144" strokeWidth="1.5"/>
      <rect x="906" y="301" width="11" height="13" rx="3" fill="#c9d9ca" stroke="#527d69"/>
      <circle cx="911" cy="322" r="3.5" fill={sensorConnected?'#c0df9c':'#ddaf74'}/>
      <path d="M901 350H921V414L911 434L901 414Z" fill="#d7cf9c" stroke="#b3a572" strokeWidth="1.5"/>
      <path d="M907 360V411L911 419L915 411V360" fill="none" stroke="#a38f54" strokeWidth="2"/>
      <path d="M902 366H920" stroke="#fbf0cc" strokeWidth="2" strokeDasharray="3 2"/>
      <circle cx="911" cy="287" r="15" fill="#e5eee0" stroke="#a4bba1"/>
      <text x="911" y="292" textAnchor="middle" className="device-number">05</text>
      {/* 文字同属设备按钮，点标签也可以识别探头。 */}
      <text x="998" y="380" textAnchor="middle" className="probe-label"><tspan x="998">湿</tspan><tspan x="998" dy="20">度</tspan><tspan x="998" dy="20">探</tspan><tspan x="998" dy="20">头</tspan></text>
    </Device>
    <g pointerEvents="none">
      <rect x="767" y="344" width="16" height="10" rx="3" fill="#658e8f"/>
      {watering&&<g fill="#448f9f" className={animated?'water-drops':''}><path d="M775 357Q766 370 775 373Q784 370 775 357"/><path d="M781 374Q776 382 781 384Q786 382 781 374"/></g>}
      {showRain&&<g stroke="#6095ac" strokeWidth="2" strokeLinecap="round" className="rain-lines">{[754,783,812,841,870,899,928].map((x,i)=><path key={x} d={`M${x} ${178+i%2*12}l-4 13m-3 24-4 13`}/>)}</g>}
    </g>
  </svg>;
}

export default function LabScene({ reading=1800, weather='sunny', pumpOn=false, waterMl=0, sensorConnected=true, pumpConnected=true, actualRain=false, fraction=.44, mode='preview', running=false, hasResult=false, decision=null, initialDeviceId='controller', onDeviceSelect }) {
  const [selected,setSelected]=useState(initialDeviceId);
  const dialog=useRef(null);
  const viewport=useRef(null);
  const expandedViewport=useRef(null);
  const watering=mode==='observation'?Boolean(decision):running&&pumpOn&&sensorConnected&&pumpConnected;
  const animated=mode==='experiment'&&watering;
  const pumpStatus=!pumpConnected?'未连接':mode==='observation'?(decision?'记录：灌溉':'记录：不灌溉'):watering?'正在供水':!sensorConnected?'等待探头连接':running?'本时刻停泵':hasResult?'测试结束 · 已停泵':'待机';
  const state={reading,weather,fraction,sensorConnected,pumpConnected,watering,animated,showRain:running&&actualRain,pumpStatus};
  const currentDevice=DEVICES.find(d=>d.id===selected);
  const statusByDevice={tank:'默认水源充足',pump:pumpStatus,controller:sensorConnected?`${mode==='preview'?'示例':'当前'}读数 ${reading}`:'未收到探头读数',driver:!pumpConnected?'水泵输出断开':watering?'输出开启':'输出关闭',sensor:sensorConnected?'信号已接入':'信号未连接',pot:mode==='experiment'&&hasResult?`本次供水 ${Math.round(waterMl)} mL`:'土壤剖面示意'};
  function chooseDevice(id, expanded=false){
    setSelected(id);
    // 首页没有回调；实验页才将设备关注点同步给教学助理。
    onDeviceSelect?.(id);
    // 窄屏保持图形可读；点选设备时将对应位置滚入图内视口。
    const centers={tank:170,pump:477,controller:480,driver:480,sensor:912,pot:838};
    const element=(expanded?expandedViewport:viewport).current;
    element.scrollTo({left:centers[id]/1020*element.scrollWidth-element.clientWidth/2,behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
  }
  function parts(expanded=false){return <div className="equipment-parts" aria-label="选择要识别的设备">{DEVICES.map(d=><button type="button" key={d.id} aria-pressed={selected===d.id} onClick={()=>chooseDevice(d.id,expanded)}><span>{d.number}</span>{d.name}</button>)}</div>;}
  function details(){return <div className="equipment-detail" aria-live="polite"><div><strong>{currentDevice.name}</strong><span className="equipment-state">{statusByDevice[selected]}</span></div><p>{currentDevice.description}</p></div>;}
  const sceneLabel=mode==='preview'?'设备识别图':mode==='observation'?'运行记录示意':'实验设备实况';
  return <section className={`equipment-scene mode-${mode}`} aria-label={sceneLabel}>
    <div className="equipment-toolbar"><span>{sceneLabel}</span><button type="button" className="text-button" onClick={()=>dialog.current.showModal()}><Expand size={15}/>放大查看</button></div>
    {/* 窄屏先说明图内横向查看方式，避免学生误以为右侧设备被截掉。 */}
    <p className="scene-pan-hint"><MoveHorizontal size={15}/>可横向查看全图，也可点选下方设备定位。</p>
    <div className="scene-canvas" ref={viewport}><EquipmentDrawing state={state} selected={selected} onSelect={chooseDevice}/></div>
    <div className="equipment-legend"><span><i className="legend-water"/>水流方向</span><span><i className="legend-drive"/>控制 / 驱动</span><span><i className="legend-signal"/>传感器信号</span></div>
    {parts()}{details()}
    {mode==='experiment'&&<div className="equipment-readings" aria-label="当前图示状态"><span><Activity size={15}/>{pumpStatus}</span><span><Droplets size={15}/>{hasResult?`本次供水 ${Math.round(waterMl)} mL`:'尚未开始测试'}</span><span>{running?actualRain?'实际降雨：正在下雨':'实际降雨：无':hasResult?actualRain?'本次记录：有降雨':'本次记录：无降雨':actualRain?'测试条件：实际降雨':'测试条件：无实际降雨'}</span></div>}
    <dialog ref={dialog} className="equipment-dialog" aria-label="放大设备识别图" onClick={event=>{if(event.target===dialog.current)dialog.current.close();}}>
      <div className="equipment-dialog-heading"><div><strong>自动灌溉 · 设备识别</strong><p>点选设备，查看它的作用与当前状态。</p></div><button type="button" className="icon-button" aria-label="关闭放大图" onClick={()=>dialog.current.close()}><X size={22}/></button></div>
      <div className="scene-canvas expanded-canvas" ref={expandedViewport}><EquipmentDrawing state={state} selected={selected} onSelect={id=>chooseDevice(id,true)}/></div>
      {parts(true)}{details()}
      <p className="equipment-note">蓝色为水路，金色为控制 / 驱动，绿色为传感器信号。电源与公共接地省略。</p>
    </dialog>
  </section>;
}
