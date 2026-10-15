import { useState, type ReactNode } from 'react';
import { FILE_TYPE_NAMES, fileKeyOf } from '../core/address';
import { EXAMPLES } from '../examples';
import { createProject, setUi, useApp } from '../store/store';

function Node({ label, children, defaultOpen = true, testId }: { label: ReactNode; children?: ReactNode; defaultOpen?: boolean; testId?: string }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="tree-node">
      <button className="tree-label folder" onClick={() => setOpen(!open)} data-testid={testId}>
        <span className="twisty">{open ? '▾' : '▸'}</span> {label}
      </button>
      {open && <div className="tree-children">{children}</div>}
    </div>
  );
}

function Leaf({ label, onClick, active, title, testId }: { label: ReactNode; onClick: () => void; active?: boolean; title?: string; testId?: string }) {
  return (
    <button className={`tree-label leaf${active ? ' active' : ''}`} onClick={onClick} title={title} data-testid={testId}>
      {label}
    </button>
  );
}

export function Explorer() {
  const project = useApp((s) => s.project);
  const tab = useApp((s) => s.bottomTab);
  const dataKey = useApp((s) => s.dataFileKey);
  if (!project) return null;
  return (
    <nav className="explorer" aria-label="Project explorer">
      <div className="panel-title">Project</div>
      <Node label={<b>{project.name}</b>}>
        <Node label={`Controller ${project.controller.name}`}>
          <Leaf label="Properties" onClick={() => setUi({ dialog: 'controller' })} />
          <Leaf label="Projects…" onClick={() => setUi({ dialog: 'projects' })} testId="explorer-projects" />
        </Node>
        <Node label="Program Files">
          <Leaf label={`LAD ${project.program.number} - ${project.program.name}`} onClick={() => document.querySelector('.ladder-scroll')?.scrollTo({ top: 0 })} active title={`${project.program.rungs.length} rungs`} />
        </Node>
        <Node label="Data Files">
          {project.dataFiles.map((f) => (
            <Leaf
              key={fileKeyOf(f)}
              label={
                <>
                  <span className="mono">{fileKeyOf(f).padEnd(4, ' ')}</span> {FILE_TYPE_NAMES[f.type]}
                </>
              }
              active={tab === 'data' && dataKey === fileKeyOf(f)}
              onClick={() => setUi({ bottomTab: 'data', dataFileKey: fileKeyOf(f) })}
              testId={`explorer-${fileKeyOf(f)}`}
            />
          ))}
          <Leaf label="Configure…" onClick={() => setUi({ dialog: 'datafiles' })} />
        </Node>
        <Leaf label="Symbols" active={tab === 'symbols'} onClick={() => setUi({ bottomTab: 'symbols' })} />
        <Leaf label="Cross Reference" active={tab === 'xref'} onClick={() => setUi({ bottomTab: 'xref' })} />
        <Leaf label="Verify / Diagnostics" active={tab === 'verify'} onClick={() => setUi({ bottomTab: 'verify' })} />
        <Leaf label="Forces" onClick={() => setUi({ bottomTab: 'data', dataFileKey: 'I1' })} title={`${project.forces.length} force(s) installed`} />
      </Node>
      <Node label="Examples" defaultOpen>
        {EXAMPLES.map((ex) => (
          <Leaf key={ex.key} label={ex.spec.name} title={`Open a fresh copy of the ${ex.spec.name} example`} onClick={() => void createProject('', ex.key)} testId={`explorer-example-${ex.key}`} />
        ))}
      </Node>
      {project.description && <div className="project-desc">{project.description}</div>}
    </nav>
  );
}
