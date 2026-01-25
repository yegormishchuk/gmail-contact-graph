// Graph configuration
const config = {
    centerNodeRadius: 25,
    nodeRadius: 8,
    linkWidth: 1.5,
    chargeStrength: -50,
    minLinkDistance: 50,
    maxLinkDistance: 500
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

// Color scale for nodes based on activity type
function getNodeColor(d) {
    if (d.isCenter) return '#ff6b6b';

    const total = d.received + d.sent;
    const sentRatio = d.sent / (total || 1);

    const receivedColor = d3.rgb(79, 195, 247);
    const sentColor = d3.rgb(129, 199, 132);

    return d3.interpolateRgb(receivedColor, sentColor)(sentRatio);
}

// Filter data based on current filters
function filterData(data) {
    let nodes = [data.nodes[0]]; // Always include center node
    let links = [];

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

    // Get set of visible node ids
    const visibleIds = new Set(nodes.map(n => n.id));

    // Filter links
    links = data.links.filter(link => {
        const sourceId = typeof link.source === 'object' ? link.source.id : link.source;
        const targetId = typeof link.target === 'object' ? link.target.id : link.target;

        if (!visibleIds.has(sourceId) || !visibleIds.has(targetId)) return false;
        if (link.type === 'received' && !filters.showSenders) return false;
        if (link.type === 'sent' && !filters.showRecipients) return false;
        return true;
    });

    // Deep copy to avoid mutating original data
    return {
        nodes: nodes.map(n => ({...n})),
        links: links.map(l => ({
            source: typeof l.source === 'object' ? l.source.id : l.source,
            target: typeof l.target === 'object' ? l.target.id : l.target,
            type: l.type,
            count: l.count
        })),
        stats: {
            ...data.stats,
            displayedContacts: filteredContacts.length
        }
    };
}

// Render graph with current filters
function renderGraph(data) {
    const container = document.getElementById('graph-container');
    const width = container.clientWidth;
    const height = container.clientHeight;

    // Update stats
    document.getElementById('displayed-contacts').textContent = data.stats.displayedContacts;

    // Create scale for link distance
    const maxLinkCount = d3.max(data.links, d => d.count) || 1;
    const linkDistanceScale = d3.scaleLog()
        .domain([1, maxLinkCount])
        .range([config.maxLinkDistance, config.minLinkDistance]);

    // Clear SVG
    const svg = d3.select('#graph');
    svg.selectAll('*').remove();
    svg.attr('width', width).attr('height', height);

    // Add zoom behavior
    const g = svg.append('g');

    const zoom = d3.zoom()
        .scaleExtent([0.1, 4])
        .on('zoom', (event) => {
            g.attr('transform', event.transform);
        });

    svg.call(zoom);

    // Reset zoom button
    document.getElementById('reset-zoom').onclick = () => {
        svg.transition().duration(500).call(zoom.transform, d3.zoomIdentity);
    };

    // Create arrow markers
    const defs = svg.append('defs');

    defs.append('marker')
        .attr('id', 'arrow-received')
        .attr('viewBox', '0 -5 10 10')
        .attr('refX', 15)
        .attr('refY', 0)
        .attr('markerWidth', 6)
        .attr('markerHeight', 6)
        .attr('orient', 'auto')
        .append('path')
        .attr('d', 'M0,-5L10,0L0,5')
        .attr('fill', '#4fc3f7');

    defs.append('marker')
        .attr('id', 'arrow-sent')
        .attr('viewBox', '0 -5 10 10')
        .attr('refX', 15)
        .attr('refY', 0)
        .attr('markerWidth', 6)
        .attr('markerHeight', 6)
        .attr('orient', 'auto')
        .append('path')
        .attr('d', 'M0,-5L10,0L0,5')
        .attr('fill', '#81c784');

    // Stop previous simulation
    if (currentSimulation) {
        currentSimulation.stop();
    }

    // Create force simulation
    currentSimulation = d3.forceSimulation(data.nodes)
        .force('link', d3.forceLink(data.links)
            .id(d => d.id)
            .distance(d => linkDistanceScale(d.count)))
        .force('charge', d3.forceManyBody()
            .strength(config.chargeStrength))
        .force('center', d3.forceCenter(width / 2, height / 2))
        .force('collision', d3.forceCollide()
            .radius(d => (d.isCenter ? config.centerNodeRadius : config.nodeRadius) + 5));

    // Create links
    const link = g.append('g')
        .attr('class', 'links')
        .selectAll('line')
        .data(data.links)
        .enter()
        .append('line')
        .attr('class', d => `link link-${d.type}`)
        .attr('stroke-width', config.linkWidth)
        .attr('marker-end', d => `url(#arrow-${d.type})`);

    // Create nodes
    const node = g.append('g')
        .attr('class', 'nodes')
        .selectAll('circle')
        .data(data.nodes)
        .enter()
        .append('circle')
        .attr('class', d => d.isCenter ? 'node-center' : 'node-contact')
        .attr('r', d => d.isCenter ? config.centerNodeRadius : config.nodeRadius)
        .attr('fill', getNodeColor)
        .call(d3.drag()
            .on('start', dragstarted)
            .on('drag', dragged)
            .on('end', dragended));

    // Create labels
    const label = g.append('g')
        .attr('class', 'labels')
        .selectAll('text')
        .data(data.nodes)
        .enter()
        .append('text')
        .attr('class', d => d.isCenter ? 'label label-center' : 'label')
        .attr('text-anchor', 'middle')
        .attr('dy', d => d.isCenter ? config.centerNodeRadius + 15 : config.nodeRadius + 12)
        .text(d => d.name.length > 15 ? d.name.substring(0, 12) + '...' : d.name);

    // Tooltip
    const tooltip = d3.select('#tooltip');

    node.on('mouseover', (event, d) => {
        if (d.isCenter) return;

        tooltip.select('.tooltip-name').text(d.name);
        tooltip.select('.tooltip-email').text(d.email);
        tooltip.select('.tooltip-stat-value.received').text(d.received.toLocaleString());
        tooltip.select('.tooltip-stat-value.sent').text(d.sent.toLocaleString());

        tooltip
            .style('left', (event.pageX + 15) + 'px')
            .style('top', (event.pageY - 10) + 'px')
            .classed('visible', true);
    })
    .on('mousemove', (event) => {
        tooltip
            .style('left', (event.pageX + 15) + 'px')
            .style('top', (event.pageY - 10) + 'px');
    })
    .on('mouseout', () => {
        tooltip.classed('visible', false);
    });

    // Update positions on tick
    currentSimulation.on('tick', () => {
        link
            .attr('x1', d => d.source.x)
            .attr('y1', d => d.source.y)
            .attr('x2', d => d.target.x)
            .attr('y2', d => d.target.y);

        node
            .attr('cx', d => d.x)
            .attr('cy', d => d.y);

        label
            .attr('x', d => d.x)
            .attr('y', d => d.y);
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
        d.fx = null;
        d.fy = null;
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

// Start
init();
