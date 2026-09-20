import React, { useState } from "react";

type Profile = {
  name: string;
  avatar: string;
};

export function Avatar({ profile }: { profile: Profile }) {
  return (
    <div className="avatar-wrapper">
      <img src={profile.avatar} />
    </div>
  );
}

export function ProfileForm() {
  const [name, setName] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const profile = {
    name,
    avatar: "/avatar.png",
  };

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitted(true);
  }

  return (
    <form onSubmit={handleSubmit}>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
      />

      <Avatar profile={profile} />

      {/* Critical Test Cases */}
      {/* Case 1 */}
      <img src="/case1.png" />
      
      {/* Case 2 */}
      <img
        src="/case2.png"
      />

      {/* Case 3 */}
      <img
        src="/case3.png"
        className="avatar"
      />

      {/* Case 4 */}
      <img
        className="avatar"
        src="/case4.png"
      />

      {/* Multiple elements on one line */}
      <div className="gallery"><img src="/multi1.png" /><img src="/multi2.png" /></div>

      <button type="submit">
        Save
      </button>

      {submitted && <p>Saved successfully</p>}
    </form>
  );
}