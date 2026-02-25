// Graph rendering module
import { config } from './config.js';
import * as state from './state.js';
import { getNodeRadius } from './utils.js';

// Render graph with current filters
export function renderGraph(data) {
    const container = document.getElementById('graph-container');
    const width = container.clientWidth;
    const height = container.clientHeight;
    const centerX = width / 2;
    const centerY = height / 2;

    // Update stats
    document.getElementById('displayed-contacts').textContent = data.stats.displayedContacts;

    // Calculate max activity for scaling
    const maxScore = d3.max(data.nodes.slice(1), d => d.compositeScore || 0) || 1;

    // Store current nodes for search
    state.setCurrentNodes(data.nodes);

    // Clear SVG
    const svg = d3.select('#graph');
    state.setCurrentSvg(svg);
    svg.selectAll('*').remove();
    svg.attr('width', width).attr('height', height);

    // Add hatching pattern for unclear contacts
    const defs = svg.append('defs');
    const hatchPattern = defs.append('pattern')
        .attr('id', 'hatch-pattern')
        .attr('patternUnits', 'userSpaceOnUse')
        .attr('width', 6)
        .attr('height', 6)
        .attr('patternTransform', 'rotate(45)');
    hatchPattern.append('line')
        .attr('x1', 0).attr('y1', 0)
        .attr('x2', 0).attr('y2', 6)
        .attr('stroke', 'rgba(255, 255, 255, 0.4)')
        .attr('stroke-width', 1.5);

    // Add zoom behavior
    const g = svg.append('g');

    const zoom = d3.zoom()
        .scaleExtent([0.3, 3])
        .on('zoom', (event) => {
            state.setCurrentTransform(event.transform);
            g.attr('transform', event.transform);
        });

    state.setCurrentZoom(zoom);
    svg.call(zoom);

    // Restore previous transform
    if (state.currentTransform !== d3.zoomIdentity) {
        svg.call(zoom.transform, state.currentTransform);
    }

    // Reset zoom button
    document.getElementById('reset-zoom').onclick = () => {
        state.setCurrentTransform(d3.zoomIdentity);
        svg.transition().duration(500).call(zoom.transform, d3.zoomIdentity);
    };

    // Stop previous simulation
    if (state.currentSimulation) {
        state.currentSimulation.stop();
    }

    // Create force simulation
    const simulation = d3.forceSimulation(data.nodes)
        .force('charge', d3.forceManyBody()
            .strength(config.chargeStrength))
        .force('center', d3.forceCenter(centerX, centerY))
        .force('collision', d3.forceCollide()
            .radius(d => getNodeRadius(d, maxScore) + config.collisionPadding))
        .force('x', d3.forceX(centerX).strength(config.centerStrength))
        .force('y', d3.forceY(centerY).strength(config.centerStrength));

    state.setCurrentSimulation(simulation);

    // Fix center node position
    data.nodes.forEach(node => {
        if (node.isCenter) {
            node.fx = centerX;
            node.fy = centerY;
        }
    });

    // Create link groups (drawn below nodes)
    const domainLinksGroup = g.append('g').attr('class', 'domain-links');
    const groupLinksGroup = g.append('g').attr('class', 'group-links');

    // Create nodes group
    const nodesGroup = g.append('g').attr('class', 'nodes');

    // Create node groups
    const nodeGroups = nodesGroup.selectAll('g.node')
        .data(data.nodes)
        .enter()
        .append('g')
        .attr('class', d => {
            let classes = d.isCenter ? 'node node-center' : 'node node-contact';
            if (d.notClear) classes += ' node-unclear';
            return classes;
        });

    // Add fill-level circles to each node
    nodeGroups.each(function(d, i) {
        const group = d3.select(this);
        const radius = getNodeRadius(d, maxScore);

        if (d.isCenter) {
            // Center node - solid circle
            group.append('circle')
                .attr('r', radius)
                .attr('fill', config.centerColor)
                .attr('stroke', '#fff')
                .attr('stroke-width', 4);
        } else {
            // Contact node - fill level
            const total = (d.sent || 0) + (d.received || 0);
            const receivedRatio = total > 0 ? d.received / total : 0.5;

            const clipId = `clip-node-${i}`;

            // Clip path to constrain fill within circle
            const defs = group.append('defs');
            defs.append('clipPath')
                .attr('id', clipId)
                .append('circle')
                .attr('r', radius);

            const clipped = group.append('g')
                .attr('clip-path', `url(#${clipId})`);

            // Background: sent color (green) fills entire circle
            clipped.append('rect')
                .attr('x', -radius)
                .attr('y', -radius)
                .attr('width', radius * 2)
                .attr('height', radius * 2)
                .attr('fill', config.sentColor);

            // Received color (blue) fills from bottom up
            const fillHeight = radius * 2 * receivedRatio;
            clipped.append('rect')
                .attr('x', -radius)
                .attr('y', radius - fillHeight)
                .attr('width', radius * 2)
                .attr('height', fillHeight)
                .attr('fill', config.receivedColor);

            // Border
            const hasSent = d.sent > 0;
            group.append('circle')
                .attr('r', radius)
                .attr('fill', 'none')
                .attr('stroke', hasSent ? config.sentColor : 'rgba(255,255,255,0.3)')
                .attr('stroke-width', hasSent ? config.borderWidth : 1.5)
                .attr('class', 'node-border');

            // Hatching overlay for unclear contacts
            if (d.notClear) {
                group.append('circle')
                    .attr('r', radius)
                    .attr('fill', 'url(#hatch-pattern)')
                    .attr('class', 'node-hatch');
            }
        }
    });

    // Create labels
    const labels = g.append('g')
        .attr('class', 'labels')
        .selectAll('text')
        .data(data.nodes)
        .enter()
        .append('text')
        .attr('class', d => d.isCenter ? 'label label-center' : 'label')
        .attr('text-anchor', 'middle')
        .text(d => {
            const name = d.name;
            if (d.isCenter) return name;
            return name.length > 12 ? name.substring(0, 10) + '...' : name;
        });

    // Tooltip
    const tooltip = d3.select('#tooltip');
    const markHumanBtn = document.getElementById('mark-human-btn');
    const markNotHumanBtn = document.getElementById('mark-not-human-btn');
    const tooltipCloseBtn = document.getElementById('tooltip-close');

    // Track currently selected node
    let currentSelectedNode = null;
    let tooltipOpen = false;

    function closeTooltip() {
        if (!tooltipOpen) return;

        tooltip.classed('visible', false);
        tooltipOpen = false;

        // Restore hatching on all unclear nodes
        nodeGroups.selectAll('.node-hatch')
            .transition().duration(150)
            .style('opacity', 1);

        // Restore nodes opacity - make unclear contacts more transparent
        nodeGroups.transition().duration(150)
            .style('opacity', d => d.notClear ? 0.4 : 1);

        // Restore labels opacity - match node transparency
        labels.transition().duration(150)
            .style('opacity', d => d.notClear ? 0.4 : 1);

        // Remove domain and group edges and labels
        domainLinksGroup.selectAll('*').remove();
        groupLinksGroup.selectAll('*').remove();

        if (currentSelectedNode && !currentSelectedNode.isCenter) {
            // Restore border of selected node
            const hasSent = currentSelectedNode.sent > 0;
            nodeGroups.filter(n => n.email === currentSelectedNode.email)
                .select('.node-border')
                .attr('stroke', hasSent ? config.sentColor : 'rgba(255,255,255,0.3)')
                .attr('stroke-width', hasSent ? config.borderWidth : 1.5);

            // Restore org mate borders
            const domain = state.emailToDomain[currentSelectedNode.email];
            const sameOrgEmails = domain ? state.domainToEmails[domain] : null;
            if (sameOrgEmails) {
                const sameOrgSet = new Set(sameOrgEmails);
                nodeGroups.filter(n => sameOrgSet.has(n.email) && n.email !== currentSelectedNode.email)
                    .select('.node-border')
                    .each(function(n) {
                        const hasSent = n.sent > 0;
                        d3.select(this)
                            .attr('stroke', hasSent ? config.sentColor : 'rgba(255,255,255,0.3)')
                            .attr('stroke-width', hasSent ? config.borderWidth : 1.5);
                    });
            }

            // Restore group mate borders
            const selectedGroups = state.emailToGroups[currentSelectedNode.email] || [];
            for (const subject of selectedGroups) {
                const groupEmails = state.groupToEmails[subject] || [];
                nodeGroups.filter(n => groupEmails.includes(n.email) && n.email !== currentSelectedNode.email)
                    .select('.node-border')
                    .each(function(n) {
                        const hasSent = n.sent > 0;
                        d3.select(this)
                            .attr('stroke', hasSent ? config.sentColor : 'rgba(255,255,255,0.3)')
                            .attr('stroke-width', hasSent ? config.borderWidth : 1.5);
                    });
            }
        }

        currentSelectedNode = null;
    }

    // Close button click handler
    tooltipCloseBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        closeTooltip();
    });

    // Click outside to close tooltip
    document.addEventListener('click', (e) => {
        if (!tooltipOpen) return;

        const tooltipEl = document.getElementById('tooltip');
        if (!tooltipEl.contains(e.target)) {
            // Check if click was on a node (handled separately)
            const clickedOnNode = e.target.closest('.node');
            if (!clickedOnNode) {
                closeTooltip();
            }
        }
    });

    // Mark as human button click handler
    markHumanBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!currentSelectedNode || !currentSelectedNode.notClear) return;

        try {
            const response = await fetch('/api/contacts/mark-clear', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: currentSelectedNode.email })
            });

            if (response.ok) {
                // Update node data
                currentSelectedNode.notClear = false;

                // Remove unclear class and hatching from the node
                const nodeGroup = nodeGroups.filter(n => n.email === currentSelectedNode.email);
                nodeGroup.classed('node-unclear', false);
                nodeGroup.select('.node-hatch').remove();

                // Hide the button
                markHumanBtn.style.display = 'none';
            }
        } catch (err) {
            console.error('Failed to mark contact as clear:', err);
        }
    });

    // Mark as not human button click handler
    markNotHumanBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!currentSelectedNode) return;

        const contactEmail = currentSelectedNode.email;
        const contactName = currentSelectedNode.name;
        const contactTotal = (currentSelectedNode.received || 0) + (currentSelectedNode.sent || 0);

        try {
            const response = await fetch('/api/contacts/mark-not-human', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: contactEmail })
            });

            if (response.ok) {
                // Close tooltip first
                closeTooltip();

                // Remove from state
                state.removeContact(contactEmail);

                // Remove node from graph visualization
                nodeGroups.filter(n => n.email === contactEmail).remove();
                labels.filter(n => n.email === contactEmail).remove();

                // Remove from simulation
                if (state.currentSimulation) {
                    const nodes = state.currentSimulation.nodes();
                    const filtered = nodes.filter(n => n.email !== contactEmail);
                    state.currentSimulation.nodes(filtered);
                }

                // Remove from ranking list and recalculate places
                const rankingItem = document.querySelector(`.ranking-item[data-email="${contactEmail}"]`);
                if (rankingItem) {
                    rankingItem.remove();

                    // Recalculate all ranking places
                    const rankingList = document.getElementById('ranking-list');
                    const items = Array.from(rankingList.querySelectorAll('.ranking-item'));

                    // Get scores and sort (items are already sorted, but we need scores for ties)
                    const itemsWithScores = items.map(item => ({
                        element: item,
                        score: parseInt(item.querySelector('.ranking-score').textContent, 10)
                    }));

                    // Recalculate places with tie handling
                    let currentPlace = 0;
                    let prevScore = null;

                    itemsWithScores.forEach((item, index) => {
                        if (prevScore !== item.score) {
                            currentPlace = index + 1;
                        }
                        prevScore = item.score;

                        const placeEl = item.element.querySelector('.ranking-place');
                        placeEl.textContent = currentPlace;
                        placeEl.className = 'ranking-place';
                        if (currentPlace === 1) placeEl.classList.add('top-1');
                        else if (currentPlace === 2) placeEl.classList.add('top-2');
                        else if (currentPlace === 3) placeEl.classList.add('top-3');
                    });
                }

                // Add to spam list
                const spamList = document.getElementById('spam-list');
                const spamItem = document.createElement('div');
                spamItem.className = 'spam-item';
                spamItem.dataset.email = contactEmail;
                spamItem.dataset.name = contactName.toLowerCase();
                spamItem.innerHTML = `
                    <span class="spam-name" title="${contactEmail}">${contactName}</span>
                    <span class="spam-count">${contactTotal}</span>
                `;
                spamList.insertBefore(spamItem, spamList.firstChild);

                // Update displayed contacts count
                const displayedEl = document.getElementById('displayed-contacts');
                const current = parseInt(displayedEl.textContent.replace(/,/g, ''), 10);
                displayedEl.textContent = (current - 1).toLocaleString();

                // Update total contacts count
                const totalEl = document.getElementById('total-contacts');
                const total = parseInt(totalEl.textContent.replace(/,/g, ''), 10);
                totalEl.textContent = (total - 1).toLocaleString();
            }
        } catch (err) {
            console.error('Failed to mark contact as not human:', err);
        }
    });

    nodeGroups.on('click', function(event, d) {
        if (d.isCenter) return;
        event.stopPropagation();

        // Close previous tooltip if clicking a different node
        if (currentSelectedNode && currentSelectedNode.email !== d.email) {
            closeTooltip();
        }

        currentSelectedNode = d;
        tooltipOpen = true;

        const total = d.received + d.sent;
        const sentPercent = total > 0 ? Math.round((d.sent / total) * 100) : 0;
        const receivedPercent = total > 0 ? Math.round((d.received / total) * 100) : 0;

        tooltip.select('.tooltip-name').text(d.name);
        tooltip.select('.tooltip-email').text(d.email);
        tooltip.select('.tooltip-stat-value.received').text(`${d.received.toLocaleString()} (${receivedPercent}%)`);
        tooltip.select('.tooltip-stat-value.sent').text(`${d.sent.toLocaleString()} (${sentPercent}%)`);

        // Show org domain if contact belongs to one
        const hoveredDomain = state.emailToDomain[d.email];
        const orgEl = tooltip.select('.tooltip-org');
        if (hoveredDomain) {
            const orgSize = (state.domainToEmails[hoveredDomain] || []).length;
            orgEl.text(`@${hoveredDomain} (${orgSize} contacts)`);
            orgEl.classed('visible', true);
        } else {
            orgEl.classed('visible', false);
        }

        // Show message groups if contact belongs to any
        const hoveredGroups = state.emailToGroups[d.email] || [];
        const groupsEl = tooltip.select('.tooltip-groups');
        if (hoveredGroups.length > 0) {
            groupsEl.html(hoveredGroups.map(subject => {
                const size = (state.groupToEmails[subject] || []).length;
                return `<div>"${subject}" (${size} recipients)</div>`;
            }).join(''));
            groupsEl.classed('visible', true);
        } else {
            groupsEl.classed('visible', false);
        }

        // Show "It's a human" button only for unclear contacts
        markHumanBtn.style.display = d.notClear ? 'block' : 'none';

        // Position tooltip with boundary checking
        const tooltipNode = tooltip.node();
        tooltip.classed('visible', true);

        // Get tooltip dimensions after making visible
        const tooltipRect = tooltipNode.getBoundingClientRect();
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;

        let left = event.pageX + 15;
        let top = event.pageY - tooltipRect.height * 2 - 15;

        // Check right boundary
        if (left + tooltipRect.width > viewportWidth - 10) {
            left = event.pageX - tooltipRect.width - 15;
        }

        // Check bottom boundary - flip to above click point
        if (top + tooltipRect.height > viewportHeight - 10) {
            top = event.pageY - tooltipRect.height * 2 - 15;
        }

        // Check left boundary
        if (left < 10) {
            left = 10;
        }

        // Check top boundary
        if (top < 10) {
            top = 10;
        }

        tooltip
            .style('left', left + 'px')
            .style('top', top + 'px');

        // Hide hatching on all unclear nodes when tooltip is open
        nodeGroups.selectAll('.node-hatch')
            .transition().duration(150)
            .style('opacity', 0);

        // Highlight node
        d3.select(this).select('.node-border')
            .attr('stroke-width', config.borderWidth + 2);

        // Find same-domain contacts
        const domain = state.emailToDomain[d.email];
        const sameOrgEmails = domain ? state.domainToEmails[domain] : null;
        const sameOrgSet = sameOrgEmails ? new Set(sameOrgEmails) : new Set();

        // Get displayed nodes that belong to the same org
        const sameOrgNodes = sameOrgSet.size > 1
            ? data.nodes.filter(n => !n.isCenter && n.email !== d.email && sameOrgSet.has(n.email))
            : [];

        // Draw edges between same-org contacts (skip if org has >20 contacts — too cluttered)
        const orgTotalSize = (state.domainToEmails[domain] || []).length;
        if (sameOrgNodes.length > 0 && orgTotalSize <= 20) {
            const allOrgNodes = [d, ...sameOrgNodes];

            // Connect as a chain: each node linked to its neighbors
            for (let i = 0; i < allOrgNodes.length - 1; i++) {
                domainLinksGroup.append('line')
                    .attr('class', 'domain-link')
                    .attr('data-src', allOrgNodes[i].email)
                    .attr('data-tgt', allOrgNodes[i + 1].email)
                    .attr('x1', allOrgNodes[i].x)
                    .attr('y1', allOrgNodes[i].y)
                    .attr('x2', allOrgNodes[i + 1].x)
                    .attr('y2', allOrgNodes[i + 1].y);
            }

            // Show domain label
            const allEmails = allOrgNodes.map(n => n.email);
            domainLinksGroup.append('text')
                .attr('class', 'domain-link-label')
                .attr('data-emails', JSON.stringify(allEmails))
                .attr('x', d3.mean(allOrgNodes, n => n.x))
                .attr('y', d3.min(allOrgNodes, n => n.y) - 20)
                .attr('text-anchor', 'middle')
                .text(`@${domain}`);
        } else if (sameOrgNodes.length > 0 && orgTotalSize > 20) {
            // Large org: no edges, just show label (opacity handled in general fade below)
            domainLinksGroup.append('text')
                .attr('class', 'domain-link-label')
                .attr('data-emails', JSON.stringify([d.email]))
                .attr('x', d.x)
                .attr('y', d.y - getNodeRadius(d, maxScore) - 20)
                .attr('text-anchor', 'middle')
                .text(`@${domain} (${orgTotalSize})`);
        }

        // Draw edges between message group members
        const groupMateSet = new Set();
        for (const subject of hoveredGroups) {
            const groupEmails = state.groupToEmails[subject] || [];
            const groupNodes = data.nodes.filter(n => !n.isCenter && n.email !== d.email && groupEmails.includes(n.email));

            // Only draw lines and label if there are other visible group members
            if (groupNodes.length > 0) {
                const allGroupNodes = [d, ...groupNodes];

                for (let i = 0; i < allGroupNodes.length - 1; i++) {
                    groupLinksGroup.append('line')
                        .attr('class', 'group-link')
                        .attr('data-src', allGroupNodes[i].email)
                        .attr('data-tgt', allGroupNodes[i + 1].email)
                        .attr('data-group', subject)
                        .attr('x1', allGroupNodes[i].x)
                        .attr('y1', allGroupNodes[i].y)
                        .attr('x2', allGroupNodes[i + 1].x)
                        .attr('y2', allGroupNodes[i + 1].y);
                }

                for (const n of groupNodes) groupMateSet.add(n.email);
            }
        }

        // Highlight group mate borders
        if (groupMateSet.size > 0) {
            nodeGroups.filter(n => groupMateSet.has(n.email) && n.email !== d.email && !sameOrgSet.has(n.email))
                .select('.node-border')
                .attr('stroke', config.groupColor)
                .attr('stroke-width', config.borderWidth + 1);
        }

        // Fade non-related nodes, keep org mates and group mates visible
        const selectedNode = this;
        const largeOrg = orgTotalSize > 20;
        nodeGroups.filter(function() { return this !== selectedNode; })
            .transition().duration(150)
            .style('opacity', function(node) {
                if (node.isCenter) return 1;
                if (sameOrgSet.has(node.email)) return largeOrg ? 0.5 : 1;
                if (groupMateSet.has(node.email)) return 1;
                return 0.25;
            });

        // Highlight org mate borders
        if (sameOrgNodes.length > 0) {
            nodeGroups.filter(n => sameOrgSet.has(n.email) && n.email !== d.email)
                .select('.node-border')
                .attr('stroke', config.domainColor)
                .attr('stroke-width', config.borderWidth + 1);
        }

        // Fade non-related labels
        labels.filter(labelData => !labelData.isCenter && labelData !== d)
            .transition().duration(150)
            .style('opacity', function(labelData) {
                if (sameOrgSet.has(labelData.email)) return largeOrg ? 0.5 : 1;
                if (groupMateSet.has(labelData.email)) return 1;
                return 0.25;
            });
    });

    // Update positions on tick
    simulation.on('tick', () => {
        nodeGroups.attr('transform', d => `translate(${d.x}, ${d.y})`);

        labels
            .attr('x', d => d.x)
            .attr('y', d => d.y + getNodeRadius(d, maxScore) + 15);

        // Update domain link positions if any are visible
        domainLinksGroup.selectAll('.domain-link').each(function() {
            const line = d3.select(this);
            const srcEmail = line.attr('data-src');
            const tgtEmail = line.attr('data-tgt');
            const src = data.nodes.find(n => n.email === srcEmail);
            const tgt = data.nodes.find(n => n.email === tgtEmail);
            if (src && tgt) {
                line.attr('x1', src.x).attr('y1', src.y)
                    .attr('x2', tgt.x).attr('y2', tgt.y);
            }
        });

        // Update domain label position
        domainLinksGroup.selectAll('.domain-link-label').each(function() {
            const label = d3.select(this);
            const domainEmails = JSON.parse(label.attr('data-emails') || '[]');
            const domainNodes = data.nodes.filter(n => domainEmails.includes(n.email));
            if (domainNodes.length > 0) {
                label.attr('x', d3.mean(domainNodes, n => n.x));
                label.attr('y', d3.min(domainNodes, n => n.y) - 20);
            }
        });

        // Update group link positions
        groupLinksGroup.selectAll('.group-link').each(function() {
            const line = d3.select(this);
            const srcEmail = line.attr('data-src');
            const tgtEmail = line.attr('data-tgt');
            const src = data.nodes.find(n => n.email === srcEmail);
            const tgt = data.nodes.find(n => n.email === tgtEmail);
            if (src && tgt) {
                line.attr('x1', src.x).attr('y1', src.y)
                    .attr('x2', tgt.x).attr('y2', tgt.y);
            }
        });

    });
}
