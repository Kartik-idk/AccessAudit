import React, { useState } from "react";

type Profile = {
  name: string;
  avatar: string;
};

export function Avatar({ profile }: {profile: Profile;}) {
  return (
    <div className="avatar-wrapper">
      <img src={profile.avatar} alt="fixed" />
    </div>);

}

export function ProfileForm() {
  const [name, setName] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const profile = {
    name,
    avatar: "/avatar.png"
  };

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitted(true);
  }

  return (
    <form onSubmit={handleSubmit}>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)} />
      

      <Avatar profile={profile} />

      <button type="submit">
        Save
      </button>

      {submitted && <p>Saved successfully</p>}
    </form>);

}