import React from 'react';

export function Legend() {
  return (
    <div className="legend">
      <div className="legend-title">Legend</div>
      <div className="legend-item">
        <div className="legend-color received"></div>
        <span>Emails received</span>
      </div>
      <div className="legend-item">
        <div className="legend-color sent"></div>
        <span>Emails sent</span>
      </div>
      <div className="legend-item">
        <div className="legend-color border-indicator"></div>
        <span>Has outgoing emails</span>
      </div>
      <div className="legend-item">
        <div className="legend-color domain-indicator"></div>
        <span>Same organization</span>
      </div>
      <div className="legend-item">
        <div className="legend-color group-indicator"></div>
        <span>Message group</span>
      </div>
      <div className="legend-item">
        <div className="legend-color unclear-indicator"></div>
        <span>May not be a person</span>
      </div>
    </div>
  );
}

export default Legend;
