import React, { useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';
import { api } from '../../api/client';

interface IntroContact {
  name: string;
  email: string;
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
}

const NODE_RADIUS = 14;
const GREY = '#4a4a4a';
const ACCENT = '#00d68f';
const STAGGER_MS = 80;
const FADE_MS = 400;
const PAUSE_MS = 500;
const COLOR_MS = 600;
const OVERLAY_FADE_MS = 800;

export function IntroSequence({ onComplete }: { onComplete: () => void }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState<'loading' | 'ready' | 'animating'>('loading');
  const simulationRef = useRef<d3.Simulation<IntroContact, undefined> | null>(null);
  const excludedEmailsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    api.getAllContacts()
      .then(({ contacts, excludedEmails }) => {
        excludedEmailsRef.current = new Set(excludedEmails);
        if (!svgRef.current) return;

        const svg = d3.select(svgRef.current);
        const W = svgRef.current.clientWidth || window.innerWidth;
        const H = svgRef.current.clientHeight || window.innerHeight;

        const nodes: IntroContact[] = contacts.map(c => ({ ...c }));

        const simulation = d3.forceSimulation<IntroContact>(nodes)
          .force('charge', d3.forceManyBody().strength(-60))
          .force('center', d3.forceCenter(W / 2, H / 2))
          .force('collision', d3.forceCollide(NODE_RADIUS + 6));

        simulationRef.current = simulation;

        const nodeGroups = svg
          .selectAll<SVGGElement, IntroContact>('g.intro-node')
          .data(nodes, d => d.email)
          .enter()
          .append('g')
          .attr('class', 'intro-node');

        nodeGroups.append('circle')
          .attr('r', NODE_RADIUS)
          .attr('fill', GREY);

        nodeGroups.append('text')
          .text(d => {
            const label = d.name || d.email.split('@')[0];
            return label.length > 16 ? label.slice(0, 15) + '…' : label;
          })
          .attr('text-anchor', 'middle')
          .attr('dy', NODE_RADIUS + 14)
          .attr('fill', '#666')
          .attr('font-size', '10px')
          .attr('pointer-events', 'none');

        simulation.on('tick', () => {
          svg
            .selectAll<SVGGElement, IntroContact>('g.intro-node')
            .attr('transform', d => `translate(${d.x ?? W / 2},${d.y ?? H / 2})`);
        });

        setPhase('ready');
      })
      .catch(() => onComplete());

    return () => {
      simulationRef.current?.stop();
    };
  }, []);

  function handleCleanUp() {
    if (!svgRef.current || phase !== 'ready') return;
    setPhase('animating');
    simulationRef.current?.stop();

    const svg = d3.select(svgRef.current);
    const excludedEmails = excludedEmailsRef.current;

    // Collect excluded node elements in random order
    const excludedEls: SVGGElement[] = [];
    svg
      .selectAll<SVGGElement, IntroContact>('g.intro-node')
      .filter(d => excludedEmails.has(d.email))
      .each(function () { excludedEls.push(this); });

    for (let i = excludedEls.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [excludedEls[i], excludedEls[j]] = [excludedEls[j], excludedEls[i]];
    }

    excludedEls.forEach((el, i) => {
      const g = d3.select(el);
      g.select('circle')
        .transition()
        .delay(i * STAGGER_MS)
        .duration(FADE_MS)
        .attr('r', 0)
        .style('opacity', 0);
      g.select('text')
        .transition()
        .delay(i * STAGGER_MS)
        .duration(FADE_MS)
        .style('opacity', 0);
      g.transition()
        .delay(i * STAGGER_MS + FADE_MS)
        .remove();
    });

    const totalDelay = excludedEls.length * STAGGER_MS + FADE_MS + PAUSE_MS;

    setTimeout(() => {
      svg
        .selectAll<SVGCircleElement, IntroContact>('g.intro-node circle')
        .transition()
        .duration(COLOR_MS)
        .attr('fill', ACCENT);
    }, totalDelay);

    setTimeout(() => {
      if (overlayRef.current) {
        overlayRef.current.style.transition = `opacity ${OVERLAY_FADE_MS}ms ease`;
        overlayRef.current.style.opacity = '0';
      }
      setTimeout(() => {
        localStorage.setItem('intro_seen', 'true');
        onComplete();
      }, OVERLAY_FADE_MS);
    }, totalDelay + COLOR_MS);
  }

  return (
    <div ref={overlayRef} className="intro-overlay">
      <svg ref={svgRef} className="intro-svg" />
      {phase === 'loading' && (
        <div className="intro-loading">Loading contacts…</div>
      )}
      {phase === 'ready' && (
        <button className="intro-button" onClick={handleCleanUp}>
          Clean up spam
        </button>
      )}
    </div>
  );
}

export default IntroSequence;
