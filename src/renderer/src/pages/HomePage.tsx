import { ArrowRight, FileText, Headphones, LockKeyhole, Mic2, Sigma, Sparkles } from 'lucide-react'
import type { Page } from '../App'
import type { SessionSummary } from '../../../shared/types'

export function HomePage({ onNavigate, recent }: { onNavigate: (page: Page) => void; recent: SessionSummary[] }) {
  return (
    <div className="page page-home">
      <section className="hero-card">
        <div className="hero-copy">
          <div className="eyebrow"><Sparkles size={15} /> Clarity workflow</div>
          <h2>少一点重复整理，<br />多一点真正的复盘。</h2>
          <p>把大模型生成的公式文档写入飞书，或完整记录下一场在线面试。两个工具，一个安静的工作台。</p>
          <div className="hero-actions">
            <button className="button primary" onClick={() => onNavigate('formula')}>
              整理一篇文档 <ArrowRight size={17} />
            </button>
            <button className="button secondary" onClick={() => onNavigate('interview')}>
              准备面试录音
            </button>
          </div>
        </div>
        <div className="hero-visual" aria-hidden="true">
          <div className="orbit orbit-one" />
          <div className="orbit orbit-two" />
          <div className="visual-tile tile-formula"><Sigma size={32} /><span>公式已居中</span></div>
          <div className="visual-tile tile-audio"><Mic2 size={29} /><span className="wave"><i/><i/><i/><i/><i/></span></div>
        </div>
      </section>

      <section className="quick-grid">
        <button className="feature-card" onClick={() => onNavigate('formula')}>
          <div className="feature-icon violet"><Sigma size={22} /></div>
          <div className="feature-copy">
            <span className="feature-kicker">DOCUMENT</span>
            <h3>飞书公式排版</h3>
            <p>自动区分行内与独立公式，保留标题、列表、表格和代码块。</p>
          </div>
          <ArrowRight className="feature-arrow" size={20} />
        </button>
        <button className="feature-card" onClick={() => onNavigate('interview')}>
          <div className="feature-icon mint"><Headphones size={22} /></div>
          <div className="feature-copy">
            <span className="feature-kicker">INTERVIEW</span>
            <h3>双声道面试记录</h3>
            <p>分别保存麦克风和系统声音，并额外生成可转写的混合音轨。</p>
          </div>
          <ArrowRight className="feature-arrow" size={20} />
        </button>
      </section>

      <section className="home-lower-grid">
        <div className="panel recent-panel">
          <div className="panel-heading">
            <div><span className="section-label">RECENT</span><h3>最近的复盘</h3></div>
            <button className="text-button" onClick={() => onNavigate('sessions')}>查看全部</button>
          </div>
          {recent.length ? (
            <div className="recent-list">
              {recent.slice(0, 3).map((session) => (
                <button key={session.id} className="recent-row" onClick={() => onNavigate('sessions')}>
                  <div className="recent-icon"><FileText size={18} /></div>
                  <div><strong>{session.title}</strong><span>{new Date(session.createdAt).toLocaleString('zh-CN')}</span></div>
                  <span className={`status-badge status-${session.status}`}>{session.status === 'transcribed' ? '已转写' : '已录制'}</span>
                </button>
              ))}
            </div>
          ) : (
            <div className="empty-compact"><FileText size={23} /><span>完成第一场录音后，会在这里出现。</span></div>
          )}
        </div>
        <div className="panel principle-panel">
          <div className="principle-icon"><LockKeyhole size={24} /></div>
          <h3>不会偷偷上传</h3>
          <p>录音始终先落盘。只有你主动点击“开始转写”时，混合音频才会发送至所选服务。</p>
          <div className="principle-foot"><span className="green-dot" /> 密钥由 Windows 安全存储加密</div>
        </div>
      </section>
    </div>
  )
}
