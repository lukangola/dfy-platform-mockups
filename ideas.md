# B-Roll Tool — Design Brainstorming

## Kontext
Ein B-Roll-Generierungstool mit folgendem Workflow:
1. **Input**: Produktbild (weißer Hintergrund), Produkt-Link, Zielgruppe, Avatar-Beschreibung
2. **Shot-Generierung**: KI erzeugt Bilder nach Shot-Typen (Unboxing, Product Presentation, Product Usage, Proof/Results)
3. **Review & Feedback**: Shots einzeln oder per Chat-Interface re-prompten/regenerieren
4. **Approval**: Shots genehmigen → automatische Video-Generierung
5. **Video-Review**: Videos reviewen, re-prompten oder genehmigen
6. **Export**: Genehmigte Videos werden in kategorisierte Ordner gespeichert

---

<response>
## Idee 1: "Studio Control Room" — Broadcast-Ästhetik

<text>

### Design Movement
Inspiriert von professionellen Broadcast-Kontrollräumen und Film-Post-Production-Interfaces. Denke an DaVinci Resolve trifft Figma — eine dunkle, fokussierte Arbeitsumgebung mit präzisen Kontrollelementen und einem Gefühl von professioneller Medienproduktion.

### Core Principles
1. **Focused Darkness**: Dunkler Hintergrund lässt die generierten Medien im Vordergrund strahlen
2. **Panel-basierte Architektur**: Wie ein NLE (Non-Linear Editor) mit verschiebbaren Panels
3. **Status-Driven Color**: Farbe wird primär für Status verwendet (Pending=Amber, Approved=Grün, Rejected=Rot)
4. **Information Density**: Kompakte, aber lesbare Darstellung — jeder Pixel zählt

### Color Philosophy
- **Basis**: Tiefes Anthrazit (#0D0F12) bis Slate (#1A1D23) — der Content soll leuchten, nicht das UI
- **Akzent**: Elektrisches Cyan (#00D4FF) für aktive Elemente und Fokus-States
- **Status**: Amber (#FFB020) für Pending, Smaragd (#10B981) für Approved, Koralle (#F43F5E) für Needs Rework
- **Text**: Weiß mit 87% Opacity für primär, 60% für sekundär

### Layout Paradigm
Dreispaltig mit kollabierbarer linker Sidebar (Navigation + Shot-Typen-Filter), zentralem Content-Bereich (Grid oder Einzelansicht), und rechtem Panel (Chat/Feedback + Metadaten). Ein horizontaler Stepper am oberen Rand zeigt den Workflow-Fortschritt.

### Signature Elements
1. **Filmstrip-Navigation**: Shot-Typen werden als horizontale Filmstreifen dargestellt, die man durchscrollen kann
2. **Glowing Status Indicators**: Subtile Glow-Effekte um Thumbnails basierend auf ihrem Status
3. **Terminal-Style Chat**: Das Feedback-Interface hat eine monospace-Ästhetik wie ein Command-Terminal

### Interaction Philosophy
Keyboard-first mit sichtbaren Shortcuts. Hover-States zeigen sofort Aktionsoptionen. Drag-and-Drop für Reihenfolge. Alles fühlt sich an wie ein professionelles Werkzeug, nicht wie eine Consumer-App.

### Animation
- Smooth panel-transitions (300ms ease-out)
- Thumbnail-Zoom bei Hover mit Backdrop-Blur
- Pulsierender Glow bei aktiver Generierung
- Slide-in für Chat-Nachrichten
- Progress-Bars mit Gradient-Animation während der Generierung

### Typography System
- **Display**: JetBrains Mono (für den technischen, professionellen Charakter)
- **Body**: Inter (400/500) für Lesbarkeit
- **Labels**: JetBrains Mono Light in Uppercase für Kategorien und Status

</text>
<probability>0.07</probability>
</response>

---

<response>
## Idee 2: "Clean Canvas" — Editorial Whitespace

<text>

### Design Movement
Inspiriert von Editorial Design und Schweizer Typografie. Minimalistisch wie ein Apple-Produktkatalog, mit großzügigem Weißraum und einer Klarheit, die den generierten Content zum Protagonisten macht. Denke an Notion trifft ein hochwertiges Modemagazin.

### Core Principles
1. **Content First**: Maximale Fläche für die generierten Bilder/Videos
2. **Typographic Hierarchy**: Klare Hierarchie durch Schriftgröße und -gewicht statt durch Farbe
3. **Restraint**: Nur das Nötigste an UI-Elementen — alles andere verschwindet
4. **Breathing Room**: Großzügige Abstände zwischen Elementen schaffen Ruhe

### Color Philosophy
- **Basis**: Warmes Off-White (#FAFAF8) mit subtiler Textur — nicht steril, sondern einladend
- **Akzent**: Einziger Farbakzent ist ein tiefes Indigo (#4338CA) für CTAs und aktive States
- **Grenzen**: Sehr subtile Linien in warmem Grau (#E5E3DF) statt harter Borders
- **Text**: Tiefes Schwarz (#1A1A1A) für Headlines, Warmgrau (#6B6B6B) für Body

### Layout Paradigm
Vertikaler Flow mit Full-Width-Sektionen. Jeder Shot-Typ bekommt eine eigene "Seite" innerhalb eines vertikalen Scrolls. Die Navigation ist eine schmale, fixierte linke Leiste mit nur Icons und Tooltips. Ein Slide-Over-Panel von rechts für Feedback/Chat.

### Signature Elements
1. **Magazine-Grid**: Shots werden in einem asymmetrischen, editorial-inspirierten Grid angezeigt — nicht alle gleich groß
2. **Inline Actions**: Aktionen (Approve, Regenerate) erscheinen als elegante Overlays direkt auf den Bildern bei Hover
3. **Section Dividers**: Jede Shot-Kategorie wird durch eine große, serifenbetonte Überschrift eingeleitet

### Interaction Philosophy
Alles ist sanft und unaufdringlich. Aktionen erscheinen kontextuell. Kein visuelles Rauschen. Der Nutzer fühlt sich wie ein Art Director, der durch ein Lookbook blättert und Entscheidungen trifft.

### Animation
- Fade-in mit leichtem Scale (0.97 → 1.0) für neue Elemente
- Smooth Slide-Over für das Feedback-Panel (400ms cubic-bezier)
- Subtle parallax-Effekt beim Scrollen zwischen Sektionen
- Elegant dissolve-Transition beim Wechsel zwischen Shots und Videos
- Micro-interactions: Checkmark-Animation bei Approval

### Typography System
- **Display**: Playfair Display (Serif) für Sektions-Headlines — verleiht Editorial-Charakter
- **Body**: DM Sans (400/500) für UI-Text — modern und klar
- **Mono**: IBM Plex Mono für technische Details (Prompt-Text, IDs)

</text>
<probability>0.05</probability>
</response>

---

<response>
## Idee 3: "Neon Forge" — Cyberpunk Production Lab

<text>

### Design Movement
Inspiriert von Cyberpunk-Ästhetik und Gaming-Interfaces. Ein futuristisches "Labor"-Gefühl, das die KI-Generierung als etwas Kraftvolles und Aufregendes inszeniert. Denke an Blade Runner trifft Discord — energiegeladen, immersiv, mit einem Hauch von Sci-Fi.

### Core Principles
1. **Immersive Darkness**: Tiefschwarzer Hintergrund mit Neon-Akzenten
2. **Energy & Motion**: Alles fühlt sich lebendig an — pulsierende Elemente, Partikel, Glitch-Effekte
3. **Layered Depth**: Glassmorphism und Backdrop-Blur erzeugen Tiefenebenen
4. **Bold Categorization**: Shot-Typen werden durch distinkte Neon-Farben kodiert

### Color Philosophy
- **Basis**: Pures Schwarz (#000000) bis Deep Navy (#0A0E1A) mit subtilen Noise-Texturen
- **Neon-Palette**: Jeder Shot-Typ hat seine eigene Neon-Farbe:
  - Unboxing: Neon Pink (#FF2D8A)
  - Product Presentation: Electric Blue (#00B4FF)
  - Product Usage: Neon Green (#39FF14)
  - Proof/Results: Gold (#FFD700)
- **UI-Elemente**: Glassmorphism mit 10-20% weißer Opacity und Blur

### Layout Paradigm
Tab-basiert mit einem zentralen "Viewport" — wie ein Spiel-Interface. Oben ein Workflow-Tracker als leuchtende Pipeline. Links eine vertikale Tab-Leiste für Shot-Typen (farbkodiert). Unten ein ausklappbares "Command Center" für Chat/Feedback. Der zentrale Bereich zeigt ein Masonry-Grid der Shots.

### Signature Elements
1. **Neon Borders**: Karten haben subtile Neon-Glow-Borders in der Farbe ihres Shot-Typs
2. **Pipeline Visualizer**: Der Workflow wird als leuchtende Pipeline mit Nodes dargestellt
3. **Glitch Transitions**: Kurze Glitch-Effekte bei Regenerierung, die den KI-Prozess visuell darstellen

### Interaction Philosophy
Gamified und energiegeladen. Hover-States haben Glow-Effekte. Approvals fühlen sich wie "Power-Ups" an. Das Chat-Interface hat einen "Command Line"-Charakter. Alles vermittelt das Gefühl, eine mächtige Maschine zu steuern.

### Animation
- Neon-Pulse-Animation auf aktiven Elementen (infinite, subtle)
- Glitch-Effekt (kurzer RGB-Split) bei Regenerierung
- Partikel-Effekt bei Approval (wie ein Achievement)
- Smooth morph-Transitions zwischen Grid und Einzelansicht
- Typing-Animation im Chat-Interface
- Loading-States mit Matrix-artigen Zeichen-Kaskaden

### Typography System
- **Display**: Space Grotesk (Bold) — futuristisch aber lesbar
- **Body**: Space Grotesk (Regular/Medium) — konsistent mit dem Sci-Fi-Theme
- **Mono**: Fira Code für Prompts und technische Elemente — mit Ligaturen

</text>
<probability>0.04</probability>
</response>
