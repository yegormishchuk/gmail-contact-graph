// Application state management

// Filter state
export const filters = {
    showSenders: true,
    showRecipients: true,
    limit: 50
};

// Store raw data
export let rawData = null;
export let currentSimulation = null;
export let currentTransform = d3.zoomIdentity;
export let currentNodes = null;
export let currentSvg = null;
export let currentZoom = null;

// Domain groups: email -> domain, domain -> [emails]
export let emailToDomain = {};
export let domainToEmails = {};

// Message groups: email -> [subjects], subject -> [emails]
export let emailToGroups = {};
export let groupToEmails = {};

// State setters (needed because ES6 module exports are read-only bindings)
export function setRawData(data) {
    rawData = data;
}

export function setCurrentSimulation(simulation) {
    currentSimulation = simulation;
}

export function setCurrentTransform(transform) {
    currentTransform = transform;
}

export function setCurrentNodes(nodes) {
    currentNodes = nodes;
}

export function setCurrentSvg(svg) {
    currentSvg = svg;
}

export function setCurrentZoom(zoom) {
    currentZoom = zoom;
}

export function setEmailToDomain(data) {
    emailToDomain = data;
}

export function setDomainToEmails(data) {
    domainToEmails = data;
}

export function setEmailToGroups(data) {
    emailToGroups = data;
}

export function setGroupToEmails(data) {
    groupToEmails = data;
}
