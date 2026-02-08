// Graph configuration
const config = {
    centerNodeRadius: 30,
    minNodeRadius: 11,
    maxNodeRadius: 30,
    chargeStrength: -150,
    centerStrength: 0.05,
    collisionPadding: 10,
    sentColor: '#4ade80',      // Green for sent
    receivedColor: '#60a5fa',  // Blue for received
    centerColor: '#f87171',    // Red for center
    domainColor: '#fbbf24',    // Amber for domain/org links
    groupColor: '#c084fc',     // Purple for message groups
    borderWidth: 3
};

// Filter state
const filters = {
    showSenders: true,
    showRecipients: true,
    limit: 50
};

// Store raw data
let rawData = null;
let currentSimulation = null;
let currentTransform = d3.zoomIdentity;
let currentNodes = null;
let currentSvg = null;
let currentZoom = null;

// Domain groups: email -> domain, domain -> [emails]
let emailToDomain = {};
let domainToEmails = {};

// Message groups: email -> [subjects], subject -> [emails]
let emailToGroups = {};
let groupToEmails = {};

// Filter data based on current filters
function filterData(data) {
    let nodes = [data.nodes[0]]; // Always include center node

    // Filter contacts based on checkboxes
    let filteredContacts = data.nodes.slice(1).filter(node => {
        if (filters.showSenders && node.received > 0) return true;
        if (filters.showRecipients && node.sent > 0) return true;
        return false;
    });

    // Sort by composite score (descending) and limit
    filteredContacts.sort((a, b) => (b.compositeScore || 0) - (a.compositeScore || 0));
    filteredContacts = filteredContacts.slice(0, filters.limit);

    nodes = nodes.concat(filteredContacts);

    return {
        nodes: nodes.map(n => ({...n})),
        links: [], // No links in new design
        stats: {
            ...data.stats,
            displayedContacts: filteredContacts.length
        }
    };
}

// Calculate node radius based on composite ranking score
function getNodeRadius(d, maxScore) {
    if (d.isCenter) return config.centerNodeRadius;
    const score = d.compositeScore || 0;
    const scale = d3.scaleSqrt()
        .domain([1, maxScore])
        .range([config.minNodeRadius, config.maxNodeRadius]);
    return scale(score || 1);
}

// Render graph with current filters
function renderGraph(data) {
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
    currentNodes = data.nodes;

    // Clear SVG
    const svg = d3.select('#graph');
    currentSvg = svg;
    svg.selectAll('*').remove();
    svg.attr('width', width).attr('height', height);

    // Add zoom behavior
    const g = svg.append('g');

    const zoom = d3.zoom()
        .scaleExtent([0.3, 3])
        .on('zoom', (event) => {
            currentTransform = event.transform;
            g.attr('transform', event.transform);
        });

    currentZoom = zoom;
    svg.call(zoom);

    // Restore previous transform
    if (currentTransform !== d3.zoomIdentity) {
        svg.call(zoom.transform, currentTransform);
    }

    // Reset zoom button
    document.getElementById('reset-zoom').onclick = () => {
        currentTransform = d3.zoomIdentity;
        svg.transition().duration(500).call(zoom.transform, d3.zoomIdentity);
    };

    // Stop previous simulation
    if (currentSimulation) {
        currentSimulation.stop();
    }

    // Create force simulation
    currentSimulation = d3.forceSimulation(data.nodes)
        .force('charge', d3.forceManyBody()
            .strength(config.chargeStrength))
        .force('center', d3.forceCenter(centerX, centerY))
        .force('collision', d3.forceCollide()
            .radius(d => getNodeRadius(d, maxScore) + config.collisionPadding))
        .force('x', d3.forceX(centerX).strength(config.centerStrength))
        .force('y', d3.forceY(centerY).strength(config.centerStrength));

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
        const hoveredDomain = emailToDomain[d.email];
        const orgEl = tooltip.select('.tooltip-org');
        if (hoveredDomain) {
            const orgSize = (domainToEmails[hoveredDomain] || []).length;
            orgEl.text(`@${hoveredDomain} (${orgSize} contacts)`);
            orgEl.classed('visible', true);
        } else {
            orgEl.classed('visible', false);
        }

        // Show message groups if contact belongs to any
        const hoveredGroups = emailToGroups[d.email] || [];
        const groupsEl = tooltip.select('.tooltip-groups');
        if (hoveredGroups.length > 0) {
            groupsEl.html(hoveredGroups.map(subject => {
                const size = (groupToEmails[subject] || []).length;
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
        const domain = emailToDomain[d.email];
        const sameOrgEmails = domain ? domainToEmails[domain] : null;
        const sameOrgSet = sameOrgEmails ? new Set(sameOrgEmails) : new Set();

        // Get displayed nodes that belong to the same org
        const sameOrgNodes = sameOrgSet.size > 1
            ? data.nodes.filter(n => !n.isCenter && n.email !== d.email && sameOrgSet.has(n.email))
            : [];

        // Draw edges between same-org contacts (skip if org has >20 contacts — too cluttered)
        const orgTotalSize = (domainToEmails[domain] || []).length;
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
            const groupEmails = groupToEmails[subject] || [];
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
        const domain = emailToDomain[d.email];
        const sameOrgEmails = domain ? domainToEmails[domain] : null;
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
        const hoveredGroups = emailToGroups[d.email] || [];
        for (const subject of hoveredGroups) {
            const groupEmails = groupToEmails[subject] || [];
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
    currentSimulation.on('tick', () => {
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
        if (!event.active) currentSimulation.alphaTarget(0.3).restart();
        d.fx = d.x;
        d.fy = d.y;
    }

    function dragged(event, d) {
        d.fx = event.x;
        d.fy = event.y;
    }

    function dragended(event, d) {
        if (!event.active) currentSimulation.alphaTarget(0);
        if (!d.isCenter) {
            d.fx = null;
            d.fy = null;
        }
    }
}

// Apply filters and re-render
function applyFilters() {
    if (!rawData) return;
    const filteredData = filterData(rawData);
    renderGraph(filteredData);
}

// Initialize
async function init() {
    try {
        const [graphResponse, domainsResponse, groupsResponse] = await Promise.all([
            fetch('/api/graph'),
            fetch('/api/domains'),
            fetch('/api/message-groups'),
        ]);
        rawData = await graphResponse.json();

        // Build domain lookup maps
        const domainsData = await domainsResponse.json();
        emailToDomain = {};
        domainToEmails = {};
        for (const [domain, users] of Object.entries(domainsData.domain_groups || {})) {
            const emails = users.map(u => u.email);
            domainToEmails[domain] = emails;
            for (const email of emails) {
                emailToDomain[email] = domain;
            }
        }

        // Build message group lookup maps
        const groupsData = await groupsResponse.json();
        emailToGroups = {};
        groupToEmails = {};
        for (const [subject, emails] of Object.entries(groupsData.groups || {})) {
            groupToEmails[subject] = emails;
            for (const email of emails) {
                if (!emailToGroups[email]) emailToGroups[email] = [];
                emailToGroups[email].push(subject);
            }
        }

        document.getElementById('loading').style.display = 'none';

        // Update total stats
        document.getElementById('total-contacts').textContent = rawData.stats.totalContacts.toLocaleString();
        document.getElementById('total-received').textContent = rawData.stats.totalReceived.toLocaleString();
        document.getElementById('total-sent').textContent = rawData.stats.totalSent.toLocaleString();

        // Update slider max based on total contacts
        const slider = document.getElementById('contact-limit');
        slider.max = rawData.stats.totalContacts;

        // Initial render
        applyFilters();

        // Re-render on window resize (reset transform to recenter)
        window.addEventListener('resize', () => {
            currentTransform = d3.zoomIdentity;
            applyFilters();
        });

    } catch (error) {
        document.getElementById('loading').textContent = 'Loading error: ' + error.message;
        console.error('Error loading graph:', error);
    }
}

// Event listeners - apply filters in real-time
document.getElementById('show-senders').addEventListener('change', (e) => {
    filters.showSenders = e.target.checked;
    applyFilters();
});

document.getElementById('show-recipients').addEventListener('change', (e) => {
    filters.showRecipients = e.target.checked;
    applyFilters();
});

document.getElementById('contact-limit').addEventListener('input', (e) => {
    filters.limit = parseInt(e.target.value);
    document.getElementById('limit-value').textContent = filters.limit;
    applyFilters();
});

// Search functionality
const searchInput = document.getElementById('contact-search');
const searchResults = document.getElementById('search-results');
let selectedIndex = -1;

function searchContacts(query) {
    if (!rawData || !query.trim()) return [];

    const lowerQuery = query.toLowerCase().trim();

    // Search in all contacts (not just displayed ones)
    return rawData.nodes
        .filter(node => !node.isCenter)
        .filter(node => {
            const name = (node.name || '').toLowerCase();
            const email = (node.email || '').toLowerCase();
            return name.includes(lowerQuery) || email.includes(lowerQuery);
        })
        .sort((a, b) => {
            // Prioritize matches at the start
            const aName = (a.name || '').toLowerCase();
            const bName = (b.name || '').toLowerCase();
            const aEmail = (a.email || '').toLowerCase();
            const bEmail = (b.email || '').toLowerCase();

            const aStartsName = aName.startsWith(lowerQuery);
            const bStartsName = bName.startsWith(lowerQuery);
            const aStartsEmail = aEmail.startsWith(lowerQuery);
            const bStartsEmail = bEmail.startsWith(lowerQuery);

            if ((aStartsName || aStartsEmail) && !(bStartsName || bStartsEmail)) return -1;
            if (!(aStartsName || aStartsEmail) && (bStartsName || bStartsEmail)) return 1;

            // Then by composite score
            return (b.compositeScore || 0) - (a.compositeScore || 0);
        })
        .slice(0, 10);
}

function renderSearchResults(results) {
    selectedIndex = -1;

    if (results.length === 0) {
        searchResults.innerHTML = '<div class="search-no-results">No results found</div>';
        searchResults.classList.add('visible');
        return;
    }

    searchResults.innerHTML = results.map((contact, index) => `
        <div class="search-result-item" data-index="${index}" data-email="${contact.email}">
            <div class="search-result-name">${escapeHtml(contact.name)}</div>
            <div class="search-result-email">${escapeHtml(contact.email)}</div>
            <div class="search-result-stats">
                <span class="received">↓${contact.received}</span>
                <span class="sent">↑${contact.sent}</span>
            </div>
        </div>
    `).join('');

    searchResults.classList.add('visible');
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function selectContact(email) {
    // Find contact in raw data
    const contact = rawData.nodes.find(n => n.email === email && !n.isCenter);
    if (!contact) return;

    // Check if contact is currently displayed
    const displayedNode = currentNodes?.find(n => n.email === email);

    if (displayedNode) {
        // Node is displayed - focus on it
        focusOnNode(displayedNode);
    } else {
        // Node is not in current filter - add it temporarily by increasing limit
        // and re-filtering to include this contact
        focusOnContactByEmail(email);
    }

    // Clear search
    searchInput.value = '';
    searchResults.classList.remove('visible');
}

function focusOnNode(node) {
    if (!currentSvg || !currentZoom) return;

    const container = document.getElementById('graph-container');
    const width = container.clientWidth;
    const height = container.clientHeight;

    // Calculate transform to center the node
    const scale = 1.5;
    const x = width / 2 - node.x * scale;
    const y = height / 2 - node.y * scale;

    const transform = d3.zoomIdentity.translate(x, y).scale(scale);

    currentSvg.transition()
        .duration(500)
        .call(currentZoom.transform, transform)
        .on('end', () => {
            // Simulate hover on the node
            simulateNodeHover(node);
        });
}

function focusOnContactByEmail(email) {
    // Temporarily increase limit to ensure contact is visible
    const contact = rawData.nodes.find(n => n.email === email && !n.isCenter);
    if (!contact) return;

    // Calculate what limit we need
    const allContacts = rawData.nodes.filter(n => !n.isCenter);
    allContacts.sort((a, b) => (b.compositeScore || 0) - (a.compositeScore || 0));

    const contactIndex = allContacts.findIndex(c => c.email === email);
    const neededLimit = contactIndex + 1;

    // Update limit if needed
    if (neededLimit > filters.limit) {
        filters.limit = Math.min(neededLimit, rawData.stats.totalContacts);
        document.getElementById('contact-limit').value = filters.limit;
        document.getElementById('limit-value').textContent = filters.limit;
    }

    // Apply filters and then focus
    const filteredData = filterData(rawData);
    renderGraph(filteredData);

    // Wait for simulation to settle a bit, then focus
    setTimeout(() => {
        const node = currentNodes?.find(n => n.email === email);
        if (node) {
            focusOnNode(node);
        }
    }, 300);
}

function simulateNodeHover(node) {
    // Find the node element and trigger mouseover
    const nodeElements = d3.selectAll('.node-contact');
    nodeElements.each(function(d) {
        if (d.email === node.email) {
            const event = new MouseEvent('mouseover', {
                bubbles: true,
                clientX: window.innerWidth / 2,
                clientY: window.innerHeight / 2
            });
            this.dispatchEvent(event);
        }
    });
}

// Search input events
searchInput.addEventListener('input', (e) => {
    const query = e.target.value;

    if (!query.trim()) {
        searchResults.classList.remove('visible');
        return;
    }

    const results = searchContacts(query);
    renderSearchResults(results);

    // Auto-select if only one result
    if (results.length === 1) {
        selectContact(results[0].email);
    }
});

searchInput.addEventListener('keydown', (e) => {
    const items = searchResults.querySelectorAll('.search-result-item');

    if (e.key === 'ArrowDown') {
        e.preventDefault();
        selectedIndex = Math.min(selectedIndex + 1, items.length - 1);
        updateSelectedItem(items);
    } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        selectedIndex = Math.max(selectedIndex - 1, 0);
        updateSelectedItem(items);
    } else if (e.key === 'Enter') {
        e.preventDefault();
        if (selectedIndex >= 0 && items[selectedIndex]) {
            const email = items[selectedIndex].dataset.email;
            selectContact(email);
        } else {
            // Select first result
            const results = searchContacts(searchInput.value);
            if (results.length > 0) {
                selectContact(results[0].email);
            }
        }
    } else if (e.key === 'Escape') {
        searchResults.classList.remove('visible');
        searchInput.blur();
    }
});

function updateSelectedItem(items) {
    items.forEach((item, index) => {
        item.classList.toggle('selected', index === selectedIndex);
    });

    // Scroll into view
    if (items[selectedIndex]) {
        items[selectedIndex].scrollIntoView({ block: 'nearest' });
    }
}

// Click on search result
searchResults.addEventListener('click', (e) => {
    const item = e.target.closest('.search-result-item');
    if (item) {
        selectContact(item.dataset.email);
    }
});

// Close search results when clicking outside
document.addEventListener('click', (e) => {
    if (!e.target.closest('.search-group')) {
        searchResults.classList.remove('visible');
    }
});

// Start
init();
