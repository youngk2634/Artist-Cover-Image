import { GoogleGenAI } from "@google/genai";

class ScenoraApp {
    private ai: GoogleGenAI;
    
    // Forms & Controls
    private seriesPackForm: HTMLFormElement;
    private storyForm: HTMLFormElement;
    private generateBtn: HTMLButtonElement;
    private generateStoryBtn: HTMLButtonElement;

    // UI Panels
    private seriesPackContent: HTMLElement;
    private storyFramesContent: HTMLElement;
    
    // Tabs
    private tabSeriesPack: HTMLButtonElement;
    private tabStoryFrames: HTMLButtonElement;

    // Output
    private loader: HTMLElement;
    private resultsGrid: HTMLElement;
    private errorMessage: HTMLElement;

    constructor() {
        if (!process.env.API_KEY) {
            throw new Error("API_KEY environment variable not set");
        }
        this.ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

        this.seriesPackForm = document.getElementById('prompt-form') as HTMLFormElement;
        this.storyForm = document.getElementById('story-form') as HTMLFormElement;
        this.generateBtn = document.getElementById('generate-btn') as HTMLButtonElement;
        this.generateStoryBtn = document.getElementById('generate-story-btn') as HTMLButtonElement;
        
        this.seriesPackContent = document.getElementById('series-pack-content') as HTMLElement;
        this.storyFramesContent = document.getElementById('story-frames-content') as HTMLElement;

        this.tabSeriesPack = document.getElementById('tab-series-pack') as HTMLButtonElement;
        this.tabStoryFrames = document.getElementById('tab-story-frames') as HTMLButtonElement;

        this.loader = document.getElementById('loader') as HTMLElement;
        this.resultsGrid = document.getElementById('results-grid') as HTMLElement;
        this.errorMessage = document.getElementById('error-message') as HTMLElement;

        this.init();
    }

    private init(): void {
        this.seriesPackForm.addEventListener('submit', this.handleGenerateSeries.bind(this));
        this.storyForm.addEventListener('submit', this.handleGenerateStory.bind(this));
        
        this.tabSeriesPack.addEventListener('click', () => this.switchTab('series'));
        this.tabStoryFrames.addEventListener('click', () => this.switchTab('story'));
    }

    private switchTab(tab: 'series' | 'story'): void {
        const isSeries = tab === 'series';
        this.seriesPackContent.classList.toggle('hidden', !isSeries);
        this.storyFramesContent.classList.toggle('hidden', isSeries);
        this.tabSeriesPack.classList.toggle('active', isSeries);
        this.tabStoryFrames.classList.toggle('active', !isSeries);
    }

    private async handleGenerateSeries(event: Event): Promise<void> {
        event.preventDefault();
        this.setLoading(true);

        const formData = new FormData(this.seriesPackForm);
        const inputs = {
            brand: formData.get('brand') as string,
            character_id: formData.get('character') as string,
            palette: formData.get('palette') as string,
            season: formData.get('season') as string,
            scene: formData.get('scene') as string,
            title_ko: formData.get('title-ko') as string,
            title_en: formData.get('title-en') as string,
            negative: formData.get('negative-prompt') as string,
            seed: formData.get('seed') as string,
        };

        try {
            const visualBrief = await this.generateVisualBrief(inputs);
            const finalPrompt = `${visualBrief}, ${inputs.negative}`;
            
            const aspectRatios = [
                { ratio: '1:1', label: 'Album Cover' },
                { ratio: '16:9', label: 'Thumbnail' },
                { ratio: '9:16', label: 'Shorts Cover' }
            ];
            
            const seed = inputs.seed ? parseInt(inputs.seed, 10) : undefined;

            const imagePromises = aspectRatios.map(ar => {
                const config: any = {
                    numberOfImages: 1,
                    outputMimeType: 'image/png',
                    aspectRatio: ar.ratio as '1:1' | '16:9' | '9:16',
                };
                 if (seed !== undefined && !isNaN(seed)) {
                    config.seed = seed;
                }
                return this.ai.models.generateImages({
                    model: 'imagen-4.0-generate-001',
                    prompt: finalPrompt,
                    config: config
                });
            });

            const imageResults = await Promise.all(imagePromises);
            
            this.resultsGrid.innerHTML = '';
            imageResults.forEach((response, index) => {
                if (response.generatedImages && response.generatedImages.length > 0) {
                    const image = response.generatedImages[0];
                    // FIX: Correctly access the image data from `image.image.imageBytes`
                    this.displayImage(image.image.imageBytes, aspectRatios[index].label, index * 100);
                } else {
                    console.warn(`No image generated for aspect ratio: ${aspectRatios[index].label}`);
                }
            });

        } catch (error) {
            console.error('Error generating images:', error);
            this.showError('Failed to generate the visual pack. Please check the console for details.');
        } finally {
            this.setLoading(false);
        }
    }

    private async generateStoryCuts(theme: string): Promise<string[]> {
        const systemInstruction = "You are a storyboard writer. Given a theme, create a 6-part story. Each part should be a concise, visual scene description suitable for an image generation prompt. Output each of the 6 parts on a new line. Do not use numbering or bullet points.";
    
        const response = await this.ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: `Theme: ${theme}`,
            config: {
                systemInstruction: systemInstruction,
            },
        });
    
        return response.text.split('\n').filter(line => line.trim() !== '');
    }
    
    private async handleGenerateStory(event: Event): Promise<void> {
        event.preventDefault();
        this.setLoading(true);
    
        const formData = new FormData(this.storyForm);
        const theme = formData.get('story-theme') as string;
        const aspectRatio = formData.get('story-aspect-ratio') as '16:9' | '9:16';
        const seedValue = formData.get('seed') as string;
        const seed = seedValue ? parseInt(seedValue, 10) : undefined;
    
        // Get character from Series Pack form for consistency
        const characterDescription = (document.getElementById('character') as HTMLTextAreaElement).value;
    
        if (!theme) {
            this.showError('Please enter a story theme.');
            this.setLoading(false);
            return;
        }
        
        if (!characterDescription) {
            this.showError('Please enter a Character Description in the Series Pack tab.');
            this.setLoading(false);
            return;
        }
    
        try {
            const storyCuts = await this.generateStoryCuts(theme);
            if (storyCuts.length === 0) {
                throw new Error("AI failed to generate story cuts from the theme.");
            }
            
            const inputs = {
                brand: formData.get('brand') as string,
                character_id: characterDescription,
                palette: formData.get('palette') as string,
                negative: formData.get('negative-prompt') as string,
                scene: `A story sequence in ${storyCuts.length} parts based on the theme: ${theme}`, // for brief
            };
    
            const visualBrief = await this.generateVisualBrief(inputs);
            
            const imagePromises = storyCuts.map(cut => {
                const finalPrompt = `${visualBrief}. Scene: ${cut}. ${inputs.negative}`;
                const config: any = {
                    numberOfImages: 1,
                    outputMimeType: 'image/png',
                    aspectRatio: aspectRatio,
                };
                if (seed !== undefined && !isNaN(seed)) {
                    config.seed = seed;
                }

                return this.ai.models.generateImages({
                    model: 'imagen-4.0-generate-001',
                    prompt: finalPrompt,
                    config: config
                });
            });
    
            const imageResults = await Promise.all(imagePromises);
            
            this.resultsGrid.innerHTML = '';
            imageResults.forEach((response, index) => {
                if (response.generatedImages && response.generatedImages.length > 0) {
                    const image = response.generatedImages[0];
                    // FIX: Correctly access the image data from `image.image.imageBytes`
                    this.displayImage(image.image.imageBytes, `Frame ${index + 1}`, index * 100);
                } else {
                     console.warn(`No image generated for Frame ${index + 1}`);
                }
            });
    
        } catch (error) {
            console.error('Error generating story frames:', error);
            this.showError('Failed to generate story frames. Please check the console for details.');
        } finally {
            this.setLoading(false);
        }
    }
    
    private async generateVisualBrief(inputs: Record<string, string>): Promise<string> {
        const systemInstruction = `You are a creative director for consistent brand visuals.
TASK: Normalize the scene description into one concise English visual brief that preserves the brand/character consistency and palette.
OUTPUT (one paragraph, ≤ 40 words):
- Keep character’s facial features & hairstyle consistent.
- Reference the palette subtly.
- Include ambiance & composition hints (foreground/background, lighting).
- Avoid camera jargon unless critical.`;

        const userPrompt = `
- Brand: ${inputs.brand}
- Character: ${inputs.character_id}
- Palette HEX: ${inputs.palette}
- Season: ${inputs.season || 'any'}
- Scene: ${inputs.scene}
- Titles: KO=${inputs.title_ko || ''}, EN=${inputs.title_en || ''}
`;
        const response = await this.ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: userPrompt,
            config: {
                systemInstruction: systemInstruction,
            },
        });
        
        return response.text;
    }

    private displayImage(base64Image: string, label: string, delay: number): void {
        const item = document.createElement('div');
        item.className = 'result-item';
        
        const img = document.createElement('img');
        img.src = `data:image/png;base64,${base64Image}`;
        img.alt = label;

        const p = document.createElement('p');
        p.textContent = label;
        
        const overlay = document.createElement('div');
        overlay.className = 'download-overlay';

        const downloadLink = document.createElement('a');
        downloadLink.className = 'download-btn';
        downloadLink.href = `data:image/png;base64,${base64Image}`;
        downloadLink.download = `${label.replace(/[\s/]/g, '-').toLowerCase()}.png`;
        downloadLink.textContent = 'Download';

        overlay.appendChild(downloadLink);

        item.appendChild(img);
        item.appendChild(overlay);
        item.appendChild(p);
        
        // Staggered animation
        item.style.animationDelay = `${delay}ms`;

        this.resultsGrid.appendChild(item);
    }
    
    private setLoading(isLoading: boolean): void {
        this.generateBtn.disabled = isLoading;
        this.generateStoryBtn.disabled = isLoading;
        this.loader.classList.toggle('hidden', !isLoading);
        this.resultsGrid.classList.toggle('hidden', isLoading);
        this.errorMessage.classList.add('hidden');
        if (isLoading) {
            this.resultsGrid.innerHTML = '';
        }
    }

    private showError(message: string): void {
        this.resultsGrid.classList.add('hidden');
        this.errorMessage.textContent = message;
        this.errorMessage.classList.remove('hidden');
    }
}

// Initialize the app once the DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    new ScenoraApp();
});
