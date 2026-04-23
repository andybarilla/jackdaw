/* global React */
const App = () => {
  const [screen, setScreen] = React.useState(() => localStorage.getItem('jd.screen') || 'home');
  const [scenario, setScenario] = React.useState('default');
  const [selectedId, setSelectedId] = React.useState(() => localStorage.getItem('jd.sel') || 'ses-0f3a');

  React.useEffect(() => { localStorage.setItem('jd.screen', screen); }, [screen]);
  React.useEffect(() => { localStorage.setItem('jd.sel', selectedId); }, [selectedId]);

  const onSelect = (id) => { setSelectedId(id); };

  return (
    <Shell screen={screen} setScreen={setScreen} scenario={scenario} setScenario={setScenario}>
      <div key={screen} className="fade-in" style={{ flex:1, minHeight:0, display:'flex', flexDirection:'column' }}>
        {screen === 'home'     && <HomeScreen sessions={SESSIONS} selectedId={selectedId} onSelect={onSelect}/>}
        {screen === 'session'  && <SessionScreen sessions={SESSIONS} selectedId={selectedId} onSelect={onSelect}/>}
        {screen === 'explorer' && <ExplorerScreen sessions={SESSIONS} onSelect={(id)=>{ onSelect(id); setScreen('session'); }}/>}
        {screen === 'artifact' && <ArtifactScreen onSelect={(id)=>{ onSelect(id); setScreen('session'); }}/>}
        {screen === 'settings' && <SettingsScreen/>}

        {screen === 'state-no-workspace' && <StateNoWorkspace/>}
        {screen === 'state-no-sessions'  && <StateNoSessions/>}
        {screen === 'state-awaiting'     && <StateAwaiting sessions={SESSIONS} onSelect={onSelect}/>}
        {screen === 'state-blocked'      && <StateBlocked  sessions={SESSIONS} onSelect={onSelect}/>}
        {screen === 'state-historical'   && <StateHistoricalOnly sessions={SESSIONS} onSelect={onSelect}/>}
        {screen === 'state-int-pending'  && <InterventionDemo phase="pending"/>}
        {screen === 'state-int-observed' && <InterventionDemo phase="observed"/>}
        {screen === 'state-int-failed'   && <InterventionDemo phase="failed"/>}
      </div>
    </Shell>
  );
};

ReactDOM.createRoot(document.getElementById('root')).render(<App/>);
