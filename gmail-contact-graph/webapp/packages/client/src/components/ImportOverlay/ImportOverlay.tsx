import React, { useEffect, useRef } from 'react';
import * as d3 from 'd3';
import { api } from '../../api/client';
import { useAppContext } from '../../context/AppContext';
import { ImportProgress } from '../ImportProgress';
import { PLACEHOLDER_COUNT, cleanupStagger, morphPlan, shouldEndLoop } from '../../utils/importOverlay';

interface OverlayNode extends d3.SimulationNodeDatum {
  /** Stable id for the D3 join; a placeholder keeps it when it becomes a contact. */
  key: string;
  /** The contact this node stands for; null while it is a placeholder. */
  email: string | null;
}

const NODE_RADIUS = 15;
const GREY = '#4a4a4a';
const ACCENT = '#00d68f';
const FADE_MS = 200;
const PAUSE_MS = 500;
const COLOR_MS = 600;
const OVERLAY_FADE_MS = 800;
const LOOP_TICK_MS = 150;
const MORPH_SETTLE_MS = 1000;

/**
 * Plays while an import runs: a cloud of placeholder nodes where random ones
 * vanish, then, once the import is done, the real contacts with their spam
 * fading out. Mounted only while state.importOverlayOpen.
 */
export function ImportOverlay() {
  const { state, dispatch } = useAppContext();
  const status = state.importStatus;
  const svgRef = useRef<SVGSVGElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const statusRef = useRef(status);
  statusRef.current = status;

  useEffect(() => {
    const svgEl = svgRef.current;
    if (!svgEl) return;
    const svg = d3.select(svgEl);
    const W = svgEl.clientWidth || window.innerWidth;
    const H = svgEl.clientHeight || window.innerHeight;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const startedAt = Date.now();
    let cancelled = false;
    let nextId = 0;

    // New placeholders drift in from outside the screen.
    const spawn = (): OverlayNode => {
      const angle = Math.random() * 2 * Math.PI;
      const r = Math.max(W, H) * 0.6;
      return { key: `n${nextId++}`, email: null, x: W / 2 + r * Math.cos(angle), y: H / 2 + r * Math.sin(angle) };
    };

    const nodes: OverlayNode[] = Array.from({ length: PLACEHOLDER_COUNT }, spawn);

    // Keeps moving during the loop so newcomers settle in; cooled for the ending.
    const simulation = d3.forceSimulation<OverlayNode>(nodes)
      .force('x', d3.forceX(W / 2).strength(0.06))
      .force('y', d3.forceY(H / 2).strength(0.06))
      .force('collision', d3.forceCollide(NODE_RADIUS + 15))
      .alphaDecay(0.01)
      .alphaTarget(0.1);

    simulation.on('tick', () => {
      svg
        .selectAll<SVGGElement, OverlayNode>('g.overlay-node')
        .attr('transform', d => `translate(${d.x ?? W / 2},${d.y ?? H / 2})`);
    });

    // A leaving node drops out of the joins at once, then shrinks and is removed.
    function fadeOut(el: SVGGElement, delay: number) {
      const g = d3.select(el).attr('class', 'overlay-node-leaving');
      g.select('circle')
        .transition()
        .delay(delay)
        .duration(FADE_MS)
        .attr('r', 0)
        .style('opacity', 0);
      g.transition().delay(delay + FADE_MS).remove();
    }

    function render() {
      const sel = svg
        .selectAll<SVGGElement, OverlayNode>('g.overlay-node')
        .data(nodes, d => d.key);
      sel.exit<OverlayNode>().each(function () { fadeOut(this as SVGGElement, 0); });
      sel.enter()
        .append('g')
        .attr('class', 'overlay-node')
        .append('circle')
        .attr('r', 0)
        .attr('fill', GREY)
        .transition()
        .duration(FADE_MS)
        .attr('r', NODE_RADIUS);
      simulation.nodes(nodes);
    }

    function fadeAway() {
      if (overlayRef.current) {
        overlayRef.current.style.transition = `opacity ${OVERLAY_FADE_MS}ms ease`;
        overlayRef.current.style.opacity = '0';
      }
      timers.push(setTimeout(() => dispatch({ type: 'CLOSE_IMPORT' }), OVERLAY_FADE_MS));
    }

    function cleanup(excluded: Set<string>) {
      simulation.stop();
      const leaving: SVGGElement[] = [];
      svg
        .selectAll<SVGGElement, OverlayNode>('g.overlay-node')
        .filter(d => d.email !== null && excluded.has(d.email))
        .each(function () { leaving.push(this); });

      for (let i = leaving.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [leaving[i], leaving[j]] = [leaving[j], leaving[i]];
      }

      const stagger = cleanupStagger(leaving.length);
      leaving.forEach((el, i) => fadeOut(el, i * stagger));

      const totalDelay = leaving.length * stagger + FADE_MS + PAUSE_MS;
      timers.push(setTimeout(() => {
        svg
          .selectAll<SVGCircleElement, OverlayNode>('g.overlay-node circle')
          .transition()
          .duration(COLOR_MS)
          .attr('fill', ACCENT);
      }, totalDelay));
      timers.push(setTimeout(fadeAway, totalDelay + COLOR_MS));
    }

    // Placeholders become the real contacts where they stand.
    function morph(emails: string[], excluded: Set<string>) {
      const plan = morphPlan(nodes.length, emails.length);
      for (let i = 0; i < plan.reuse; i++) nodes[i].email = emails[i];
      nodes.splice(plan.reuse, plan.remove);
      for (let i = 0; i < plan.add; i++) {
        nodes.push({
          key: `n${nextId++}`,
          email: emails[plan.reuse + i],
          x: W / 2 + (Math.random() - 0.5) * 100,
          y: H / 2 + (Math.random() - 0.5) * 100,
        });
      }
      render();
      simulation.alphaTarget(0).alpha(0.5).restart();
      timers.push(setTimeout(() => cleanup(excluded), MORPH_SETTLE_MS));
    }

    function loadReal() {
      api.getAllContacts()
        .then(({ contacts, excludedEmails }) => {
          if (!cancelled) morph(contacts.map(c => c.email), new Set(excludedEmails));
        })
        .catch(() => {
          if (!cancelled) fadeAway();
        });
    }

    render();

    // Checked every tick, so an import that finished early still ends the loop.
    const loop = setInterval(() => {
      if (shouldEndLoop(statusRef.current, Date.now() - startedAt)) {
        clearInterval(loop);
        loadReal();
        return;
      }
      nodes.splice(Math.floor(Math.random() * nodes.length), 1);
      nodes.push(spawn());
      render();
    }, LOOP_TICK_MS);

    return () => {
      cancelled = true;
      clearInterval(loop);
      timers.forEach(clearTimeout);
      simulation.stop();
      // StrictMode runs this effect twice in dev: start from an empty SVG.
      svg.selectAll('*').interrupt().remove();
    };
  }, [dispatch]);

  return (
    <div
      ref={overlayRef}
      className="import-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="import-dialog-title"
    >
      <svg ref={svgRef} className="import-overlay-svg" />
      {status?.state === 'importing' && <ImportProgress status={status} />}
    </div>
  );
}

export default ImportOverlay;
