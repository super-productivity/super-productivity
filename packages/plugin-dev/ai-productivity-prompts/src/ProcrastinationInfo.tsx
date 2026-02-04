import { Component } from 'solid-js';
import './App.css';

interface ProcrastinationInfoProps {
  onBackToWork: () => void;
}

export const ProcrastinationInfo: Component<ProcrastinationInfoProps> = (props) => {
  return (
    <div class="page-fade info-content">
      <div class="intro">
        <h2>Understanding Procrastination</h2>
        <p>
          <strong>
            Procrastination is an emotion regulation problem, not a time management
            problem.
          </strong>
        </p>
      </div>

      <section>
        <h3>The Procrastination Cycle</h3>
        <p>
          When we face tasks that trigger uncomfortable emotions, we enter a feedback
          loop:
        </p>
        <div class="procrastination-graph">
          <div class="graph-item">Fear of failure</div>
          <div class="sync-icon">→</div>
          <div class="graph-item">Avoid the task</div>
          <div class="sync-icon">→</div>
          <div class="graph-item">Temporary relief</div>
          <div class="sync-icon">→</div>
          <div class="graph-item">Increased anxiety</div>
        </div>
      </section>

      <section>
        <h3>Breaking the Cycle</h3>
        <p>
          The key is to approach procrastination with curiosity and compassion, not
          judgment. Ask yourself:
        </p>
        <ul>
          <li>What emotions come up when I think about this task?</li>
          <li>What specific aspect feels most challenging?</li>
          <li>What am I afraid might happen if I start?</li>
        </ul>
      </section>

      <section>
        <h3>Practical Strategies</h3>
        <ul>
          <li>
            <strong>Start small:</strong> What's the tiniest first step you could take?
          </li>
          <li>
            <strong>Time-box:</strong> Work for just 10-25 minutes, then take a break
          </li>
          <li>
            <strong>Reframe:</strong> Focus on progress over perfection
          </li>
          <li>
            <strong>Self-compassion:</strong> Speak to yourself as you would to a good
            friend
          </li>
        </ul>
      </section>

      <section>
        <h3>Common Triggers</h3>
        <p>
          Procrastination is often triggered by perfectionism, fear of failure, feeling
          overwhelmed, unclear expectations, or finding the task boring. Identifying your
          specific trigger is the first step to moving forward.
        </p>
      </section>

      <div class="action-buttons">
        <button
          class="btn-primary"
          onClick={props.onBackToWork}
        >
          Back to work!
        </button>
      </div>
    </div>
  );
};
