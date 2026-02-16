import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TaskTitleComponent } from '../../ui/task-title/task-title.component';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatProgressBarModule } from '@angular/material/progress-bar';

interface BenchmarkTask {
  id: string;
  title: string;
  type: 'no-links' | 'url' | 'markdown';
}

interface BenchmarkResult {
  renderTimeMs: number;
  avgFps: number;
  minFps: number;
  maxFps: number;
}

@Component({
  selector: 'task-title-benchmark',
  standalone: true,
  imports: [
    CommonModule,
    TaskTitleComponent,
    MatButtonModule,
    MatCardModule,
    MatProgressBarModule,
  ],
  templateUrl: './task-title-benchmark.component.html',
  styleUrl: './task-title-benchmark.component.scss',
})
export class TaskTitleBenchmarkComponent implements OnInit {
  readonly tasks = signal<BenchmarkTask[]>([]);
  readonly isRunning = signal(false);
  readonly results = signal<BenchmarkResult | null>(null);
  readonly linkRenderingEnabled = signal(false);

  private readonly TASK_COUNT = 1000;
  private readonly TASKS_PER_TYPE = Math.floor(this.TASK_COUNT / 3);

  ngOnInit(): void {
    this.generateTasks();
  }

  private generateTasks(): void {
    const tasks: BenchmarkTask[] = [];

    // Generate 1/3 tasks with no links
    for (let i = 0; i < this.TASKS_PER_TYPE; i++) {
      tasks.push({
        id: `no-link-${i}`,
        title: `Task ${i}: Review documentation and update the codebase accordingly`,
        type: 'no-links',
      });
    }

    // Generate 1/3 tasks with URLs
    const urlOffset = this.TASKS_PER_TYPE;
    for (let i = 0; i < this.TASKS_PER_TYPE; i++) {
      tasks.push({
        id: `url-${i}`,
        title: `Task ${i + urlOffset}: Check https://example.com/page/${i} for details`,
        type: 'url',
      });
    }

    // Generate 1/3 tasks with markdown links
    const markdownOffset = this.TASKS_PER_TYPE * 2;
    for (let i = 0; i < this.TASKS_PER_TYPE; i++) {
      const taskNum = i + markdownOffset;
      tasks.push({
        id: `markdown-${i}`,
        title: `Task ${taskNum}: See [Documentation Page ${i}](https://docs.example.com/page/${i}) for more info`,
        type: 'markdown',
      });
    }

    // Shuffle to avoid bias from ordering
    this.shuffleArray(tasks);
    this.tasks.set(tasks);
  }

  private shuffleArray<T>(array: T[]): void {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
  }

  async runBenchmark(): Promise<void> {
    this.isRunning.set(true);
    this.results.set(null);

    // Wait for UI to update
    await new Promise((resolve) => setTimeout(resolve, 100));

    const startTime = performance.now();

    // Trigger change detection to render all tasks
    // Force a reflow to ensure rendering is complete
    const container = document.querySelector('.task-list-container');
    if (container) {
      // Force layout calculation
      void container.getBoundingClientRect();
    }

    const renderTime = performance.now() - startTime;

    // Measure scrolling FPS
    const fpsResults = await this.measureScrollingFps();

    this.results.set({
      renderTimeMs: renderTime,
      avgFps: fpsResults.avgFps,
      minFps: fpsResults.minFps,
      maxFps: fpsResults.maxFps,
    });

    this.isRunning.set(false);
  }

  private async measureScrollingFps(): Promise<{
    avgFps: number;
    minFps: number;
    maxFps: number;
  }> {
    const container = document.querySelector('.task-list-container') as HTMLElement;
    if (!container) {
      return { avgFps: 0, minFps: 0, maxFps: 0 };
    }

    const frameTimestamps: number[] = [];
    const scrollDuration = 2000; // Scroll for 2 seconds
    const scrollAmount = container.scrollHeight - container.clientHeight;
    let lastFrameTime = performance.now();

    const measureFrame = (): void => {
      const currentTime = performance.now();
      frameTimestamps.push(currentTime - lastFrameTime);
      lastFrameTime = currentTime;
    };

    // Scroll smoothly from top to bottom
    return new Promise((resolve) => {
      const startTime = performance.now();
      const startScroll = 0;

      const scroll = (): void => {
        const elapsed = performance.now() - startTime;
        const progress = Math.min(elapsed / scrollDuration, 1);
        const scrollOffset = scrollAmount * progress;
        const scrollPosition = startScroll + scrollOffset;

        container.scrollTop = scrollPosition;
        measureFrame();

        if (progress < 1) {
          requestAnimationFrame(scroll);
        } else {
          // Calculate FPS from frame timestamps
          const frameTimes = frameTimestamps.slice(10); // Skip first few frames for warm-up
          const fps = frameTimes.map((time) => (time > 0 ? 1000 / time : 60));

          resolve({
            avgFps: fps.reduce((a, b) => a + b, 0) / fps.length,
            minFps: Math.min(...fps),
            maxFps: Math.max(...fps),
          });
        }
      };

      requestAnimationFrame(scroll);
    });
  }

  toggleLinkRendering(): void {
    this.linkRenderingEnabled.set(!this.linkRenderingEnabled());
  }

  reset(): void {
    this.results.set(null);
    this.generateTasks();
  }

  getTasksByType(type: BenchmarkTask['type']): number {
    return this.tasks().filter((t) => t.type === type).length;
  }
}
