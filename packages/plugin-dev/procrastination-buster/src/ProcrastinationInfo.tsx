import { Component, createSignal, createEffect } from 'solid-js';
import { useTranslate } from './utils/useTranslate';
import './App.css';

interface ProcrastinationInfoProps {
  onBackToWork: () => void;
}

export const ProcrastinationInfo: Component<ProcrastinationInfoProps> = (props) => {
  const t = useTranslate();

  // Translation signals
  const [title, setTitle] = createSignal('');
  const [intro, setIntro] = createSignal('');
  const [cycleTitle, setCycleTitle] = createSignal('');
  const [cycleIntro, setCycleIntro] = createSignal('');
  const [cycleStep1, setCycleStep1] = createSignal('');
  const [cycleStep2, setCycleStep2] = createSignal('');
  const [cycleStep3, setCycleStep3] = createSignal('');
  const [cycleStep4, setCycleStep4] = createSignal('');
  const [breakingTitle, setBreakingTitle] = createSignal('');
  const [breakingIntro, setBreakingIntro] = createSignal('');
  const [breakingQ1, setBreakingQ1] = createSignal('');
  const [breakingQ2, setBreakingQ2] = createSignal('');
  const [breakingQ3, setBreakingQ3] = createSignal('');
  const [strategiesTitle, setStrategiesTitle] = createSignal('');
  const [strategyStartSmall, setStrategyStartSmall] = createSignal('');
  const [strategyStartSmallDesc, setStrategyStartSmallDesc] = createSignal('');
  const [strategyTimebox, setStrategyTimebox] = createSignal('');
  const [strategyTimeboxDesc, setStrategyTimeboxDesc] = createSignal('');
  const [strategyReframe, setStrategyReframe] = createSignal('');
  const [strategyReframeDesc, setStrategyReframeDesc] = createSignal('');
  const [strategyCompassion, setStrategyCompassion] = createSignal('');
  const [strategyCompassionDesc, setStrategyCompassionDesc] = createSignal('');
  const [triggersTitle, setTriggersTitle] = createSignal('');
  const [triggersText, setTriggersText] = createSignal('');
  const [backToWork, setBackToWork] = createSignal('');

  // Load translations and reload when language changes
  createEffect(() => {
    // Watch for language changes by accessing the currentLanguage signal
    const lang = t.currentLanguage();

    // Load all translations (this runs on mount AND when language changes)
    (async () => {
      setTitle(await t('INFO.TITLE'));
      setIntro(await t('INFO.INTRO'));
      setCycleTitle(await t('INFO.CYCLE_TITLE'));
      setCycleIntro(await t('INFO.CYCLE_INTRO'));
      setCycleStep1(await t('INFO.CYCLE_STEP_1'));
      setCycleStep2(await t('INFO.CYCLE_STEP_2'));
      setCycleStep3(await t('INFO.CYCLE_STEP_3'));
      setCycleStep4(await t('INFO.CYCLE_STEP_4'));
      setBreakingTitle(await t('INFO.BREAKING_TITLE'));
      setBreakingIntro(await t('INFO.BREAKING_INTRO'));
      setBreakingQ1(await t('INFO.BREAKING_Q1'));
      setBreakingQ2(await t('INFO.BREAKING_Q2'));
      setBreakingQ3(await t('INFO.BREAKING_Q3'));
      setStrategiesTitle(await t('INFO.STRATEGIES_TITLE'));
      setStrategyStartSmall(await t('INFO.STRATEGY_START_SMALL'));
      setStrategyStartSmallDesc(await t('INFO.STRATEGY_START_SMALL_DESC'));
      setStrategyTimebox(await t('INFO.STRATEGY_TIMEBOX'));
      setStrategyTimeboxDesc(await t('INFO.STRATEGY_TIMEBOX_DESC'));
      setStrategyReframe(await t('INFO.STRATEGY_REFRAME'));
      setStrategyReframeDesc(await t('INFO.STRATEGY_REFRAME_DESC'));
      setStrategyCompassion(await t('INFO.STRATEGY_COMPASSION'));
      setStrategyCompassionDesc(await t('INFO.STRATEGY_COMPASSION_DESC'));
      setTriggersTitle(await t('INFO.TRIGGERS_TITLE'));
      setTriggersText(await t('INFO.TRIGGERS_TEXT'));
      setBackToWork(await t('INFO.BACK_TO_WORK'));
    })();
  });

  return (
    <div class="page-fade info-content">
      <div class="intro">
        <h2>{title()}</h2>
        <p>
          <strong>{intro()}</strong>
        </p>
      </div>

      <section>
        <h3>{cycleTitle()}</h3>
        <p>{cycleIntro()}</p>
        <div class="procrastination-graph">
          <div class="graph-item">{cycleStep1()}</div>
          <div class="sync-icon">→</div>
          <div class="graph-item">{cycleStep2()}</div>
          <div class="sync-icon">→</div>
          <div class="graph-item">{cycleStep3()}</div>
          <div class="sync-icon">→</div>
          <div class="graph-item">{cycleStep4()}</div>
        </div>
      </section>

      <section>
        <h3>{breakingTitle()}</h3>
        <p>{breakingIntro()}</p>
        <ul>
          <li>{breakingQ1()}</li>
          <li>{breakingQ2()}</li>
          <li>{breakingQ3()}</li>
        </ul>
      </section>

      <section>
        <h3>{strategiesTitle()}</h3>
        <ul>
          <li>
            <strong>{strategyStartSmall()}</strong> {strategyStartSmallDesc()}
          </li>
          <li>
            <strong>{strategyTimebox()}</strong> {strategyTimeboxDesc()}
          </li>
          <li>
            <strong>{strategyReframe()}</strong> {strategyReframeDesc()}
          </li>
          <li>
            <strong>{strategyCompassion()}</strong> {strategyCompassionDesc()}
          </li>
        </ul>
      </section>

      <section>
        <h3>{triggersTitle()}</h3>
        <p>{triggersText()}</p>
      </section>

      <div class="action-buttons">
        <button
          class="btn-primary"
          onClick={props.onBackToWork}
        >
          {backToWork()}
        </button>
      </div>
    </div>
  );
};
