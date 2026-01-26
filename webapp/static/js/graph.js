// Graph configuration
const config = {
    centerNodeRadius: 30,
    minNodeRadius: 15,
    maxNodeRadius: 40,
    chargeStrength: -150,
    centerStrength: 0.05,
    collisionPadding: 10,
    sentColor: '#4ade80',      // Green for sent
    receivedColor: '#60a5fa',  // Blue for received
    centerColor: '#f87171',    // Red for center
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

// Filter data based on current filters
function filterData(data) {
    let nodes = [data.nodes[0]]; // Always include center node

    // Filter contacts based on checkboxes
    let filteredContacts = data.nodes.slice(1).filter(node => {
        if (filters.showSenders && node.received > 0) return true;
        if (filters.showRecipients && node.sent > 0) return true;
        return false;
    });

    // Sort by total activity and limit
    filteredContacts.sort((a, b) => (b.received + b.sent) - (a.received + a.sent));
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

// Calculate node radius based on activity
function getNodeRadius(d, maxActivity) {
    if (d.isCenter) return config.centerNodeRadius;
    const total = d.received + d.sent;
    const scale = d3.scaleSqrt()
        .domain([1, maxActivity])
        .range([config.minNodeRadius, config.maxNodeRadius]);
    return scale(total || 1);
}

// Create pie chart arc generator
function createPieArc(radius) {
    return d3.arc()
        .innerRadius(0)
        .outerRadius(radius);
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
    const maxActivity = d3.max(data.nodes.slice(1), d => d.received + d.sent) || 1;

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
            .radius(d => getNodeRadius(d, maxActivity) + config.collisionPadding))
        .force('x', d3.forceX(centerX).strength(config.centerStrength))
        .force('y', d3.forceY(centerY).strength(config.centerStrength));

    // Fix center node position
    data.nodes.forEach(node => {
        if (node.isCenter) {
            node.fx = centerX;
            node.fy = centerY;
        }
    });

    // Create nodes group
    const nodesGroup = g.append('g').attr('class', 'nodes');

    // Pie layout
    const pie = d3.pie()
        .value(d => d.value)
        .sort(null);

    // Create node groups
    const nodeGroups = nodesGroup.selectAll('g.node')
        .data(data.nodes)
        .enter()
        .append('g')
        .attr('class', d => d.isCenter ? 'node node-center' : 'node node-contact');

    // Add pie charts to each node
    nodeGroups.each(function(d) {
        const group = d3.select(this);
        const radius = getNodeRadius(d, maxActivity);
        const arc = createPieArc(radius);

        if (d.isCenter) {
            // Center node - solid circle
            group.append('circle')
                .attr('r', radius)
                .attr('fill', config.centerColor)
                .attr('stroke', '#fff')
                .attr('stroke-width', 4);
        } else {
            // Contact node - pie chart
            const pieData = pie([
                { type: 'sent', value: d.sent || 0.01 },
                { type: 'received', value: d.received || 0.01 }
            ]);

            // Draw pie segments
            group.selectAll('path')
                .data(pieData)
                .enter()
                .append('path')
                .attr('d', arc)
                .attr('fill', segment => segment.data.type === 'sent' ? config.sentColor : config.receivedColor)
                .attr('class', 'pie-segment');

            // Add border - green if has sent, otherwise default
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

        tooltip
            .style('left', (event.pageX + 15) + 'px')
            .style('top', (event.pageY - 10) + 'px')
            .classed('visible', true);

        // Highlight node
        d3.select(this).select('.node-border')
            .attr('stroke-width', config.borderWidth + 2);

        // Fade other nodes
        const hoveredNode = this;
        nodeGroups.filter(function() { return this !== hoveredNode; })
            .transition().duration(150)
            .style('opacity', node => node.isCenter ? 1 : 0.25);

        // Fade other labels
        labels.filter((_, i, nodes) => {
            const labelData = d3.select(nodes[i]).datum();
            return labelData !== d && !labelData.isCenter;
        })
            .transition().duration(150)
            .style('opacity', 0.25);
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
            .attr('y', d => d.y + getNodeRadius(d, maxActivity) + 15);
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
        const response = await fetch('/api/graph');
        rawData = await response.json();

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
        document.getElementById('loading').textContent = 'Ошибка загрузки: ' + error.message;
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

            // Then by activity
            return (b.received + b.sent) - (a.received + a.sent);
        })
        .slice(0, 10);
}

function renderSearchResults(results) {
    selectedIndex = -1;

    if (results.length === 0) {
        searchResults.innerHTML = '<div class="search-no-results">Ничего не найдено</div>';
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
    allContacts.sort((a, b) => (b.received + b.sent) - (a.received + a.sent));

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
