import { GRADES, type Mark } from "@/lib/marks";
import { setGrade } from "@/lib/store";

/* The teacher's verdict on the whole submission, so it sits with the page and not in the Claude panel. */
export function GradeBar({ marks }: { marks: Mark[] }) {
  const current = marks.find((mark) => mark.type === "text" && mark.grade);
  const letter = current?.type === "text" ? current.text : null;
  return (
    <div id="grades" role="group" aria-label="等第">
      <span>等第</span>
      {GRADES.map((grade) => (
        <button
          key={grade}
          className={grade === letter ? "on" : ""}
          title={grade === letter ? "取消等第" : `打 ${grade}`}
          onClick={() => setGrade(grade)}
        >
          {grade}
        </button>
      ))}
    </div>
  );
}
