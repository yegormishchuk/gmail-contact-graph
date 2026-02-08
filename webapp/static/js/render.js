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
        .attr('class', d => d.isCenter ? 'node node-center' : 'node node-contact');

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
        }
    });

    // Add drag behavior
    nodeGroups.call(d3.drag()
        .on('start', dragstarted)
        .on('drag', dragged)
        .on('end', dragended));

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

    nodeGroups.on('mouseover', function(event, d) {
        if (d.isCenter) return;

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

        tooltip
            .style('left', (event.pageX + 15) + 'px')
            .style('top', (event.pageY - 10) + 'px')
            .classed('visible', true);

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

            if (groupNodes.length > 0) {
                const allGroupNodes = [d, ...groupNodes];

                for (let i = 0; i < allGroupNodes.length - 1; i++) {
                    groupLinksGroup.append('line')
                        .attr('class', 'group-link')
                        .attr('data-src', allGroupNodes[i].email)
                        .attr('data-tgt', allGroupNodes[i + 1].email)
                        .attr('x1', allGroupNodes[i].x)
                        .attr('y1', allGroupNodes[i].y)
                        .attr('x2', allGroupNodes[i + 1].x)
                        .attr('y2', allGroupNodes[i + 1].y);
                }

                const allEmails = allGroupNodes.map(n => n.email);
                groupLinksGroup.append('text')
                    .attr('class', 'group-link-label')
                    .attr('data-emails', JSON.stringify(allEmails))
                    .attr('x', d3.mean(allGroupNodes, n => n.x))
                    .attr('y', d3.max(allGroupNodes, n => n.y) + 25)
                    .attr('text-anchor', 'middle')
                    .text(`"${subject}"`);

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
        const hoveredNode = this;
        const largeOrg = orgTotalSize > 20;
        nodeGroups.filter(function() { return this !== hoveredNode; })
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
    })
    .on('mousemove', (event) => {
        tooltip
            .style('left', (event.pageX + 15) + 'px')
            .style('top', (event.pageY - 10) + 'px');
    })
    .on('mouseout', function(event, d) {
        tooltip.classed('visible', false);

        if (!d.isCenter) {
            const hasSent = d.sent > 0;
            d3.select(this).select('.node-border')
                .attr('stroke-width', hasSent ? config.borderWidth : 1.5);
        }

        // Remove domain and group edges and labels
        domainLinksGroup.selectAll('*').remove();
        groupLinksGroup.selectAll('*').remove();

        // Restore org mate borders
        const domain = state.emailToDomain[d.email];
        const sameOrgEmails = domain ? state.domainToEmails[domain] : null;
        if (sameOrgEmails) {
            const sameOrgSet = new Set(sameOrgEmails);
            nodeGroups.filter(n => sameOrgSet.has(n.email) && n.email !== d.email)
                .select('.node-border')
                .each(function(n) {
                    const hasSent = n.sent > 0;
                    d3.select(this)
                        .attr('stroke', hasSent ? config.sentColor : 'rgba(255,255,255,0.3)')
                        .attr('stroke-width', hasSent ? config.borderWidth : 1.5);
                });
        }

        // Restore group mate borders
        const hoveredGroups = state.emailToGroups[d.email] || [];
        for (const subject of hoveredGroups) {
            const groupEmails = state.groupToEmails[subject] || [];
            nodeGroups.filter(n => groupEmails.includes(n.email) && n.email !== d.email)
                .select('.node-border')
                .each(function(n) {
                    const hasSent = n.sent > 0;
                    d3.select(this)
                        .attr('stroke', hasSent ? config.sentColor : 'rgba(255,255,255,0.3)')
                        .attr('stroke-width', hasSent ? config.borderWidth : 1.5);
                });
        }

        // Restore all nodes opacity
        nodeGroups.transition().duration(150)
            .style('opacity', 1);

        // Restore all labels opacity
        labels.transition().duration(150)
            .style('opacity', 1);
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

        // Update group label position
        groupLinksGroup.selectAll('.group-link-label').each(function() {
            const label = d3.select(this);
            const groupEmails = JSON.parse(label.attr('data-emails') || '[]');
            const groupNodes = data.nodes.filter(n => groupEmails.includes(n.email));
            if (groupNodes.length > 0) {
                label.attr('x', d3.mean(groupNodes, n => n.x));
                label.attr('y', d3.max(groupNodes, n => n.y) + 25);
            }
        });
    });

    // Drag functions
    function dragstarted(event, d) {
        if (!event.active) simulation.alphaTarget(0.3).restart();
        d.fx = d.x;
        d.fy = d.y;
    }

    function dragged(event, d) {
        d.fx = event.x;
        d.fy = event.y;
    }

    function dragended(event, d) {
        if (!event.active) simulation.alphaTarget(0);
        if (!d.isCenter) {
            d.fx = null;
            d.fy = null;
        }
    }
}
